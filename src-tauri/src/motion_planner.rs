use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone)]
pub struct MachineConfig {
    #[serde(alias = "maxVX", alias = "maxVx")]
    pub max_v_x: f64,
    #[serde(alias = "maxVY", alias = "maxVy")]
    pub max_v_y: f64,
    #[serde(alias = "maxVZ", alias = "maxVz")]
    pub max_v_z: f64,
    #[serde(alias = "maxAX", alias = "maxAx")]
    pub max_a_x: f64,
    #[serde(alias = "maxAY", alias = "maxAy")]
    pub max_a_y: f64,
    #[serde(alias = "maxAZ", alias = "maxAz")]
    pub max_a_z: f64,
    #[serde(alias = "junctionDeviation")]
    pub junction_deviation: f64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MachiningStatistics {
    pub total_time_sec: f64,
    pub cutting_time_sec: f64,
    pub rapid_time_sec: f64,
    pub static_delay_sec: f64,

    pub total_distance_mm: f64,
    pub cutting_distance_mm: f64,
    pub rapid_distance_mm: f64,

    pub total_blocks: u32,
    pub z_plunges: u32,
    pub m_command_toggles: u32,
    pub arc_segments: u32,

    pub max_achieved_velocity: f64,
    pub velocity_limited_corners: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MotionMode {
    Rapid,
    Linear,
    ArcCw,
    ArcCcw,
}

#[derive(Clone, Copy, Debug)]
struct ParserState {
    x: f64,
    y: f64,
    z: f64,
    feed_mm_per_min: f64,
    motion_mode: MotionMode,
    absolute: bool,
    unit_scale: f64,
}

impl Default for ParserState {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            feed_mm_per_min: 1500.0,
            motion_mode: MotionMode::Rapid,
            absolute: true,
            unit_scale: 1.0,
        }
    }
}

#[derive(Clone, Debug, Default)]
struct MotionBlock {
    dx: f64,
    dy: f64,
    dz: f64,
    distance: f64,
    is_rapid: bool,
    is_z_plunge: bool,
    target_velocity: f64,
    max_entry_speed: f64,
    entry_speed: f64,
    exit_speed: f64,
    acceleration: f64,
}

#[derive(Clone, Copy, Debug)]
struct Point3 {
    x: f64,
    y: f64,
    z: f64,
}

#[tauri::command]
pub async fn estimate_machining_time(
    gcode: String,
    config: MachineConfig,
) -> Result<MachiningStatistics, String> {
    tauri::async_runtime::spawn_blocking(move || estimate_machining_time_sync(&gcode, &config))
        .await
        .map_err(|error| error.to_string())?
}

fn estimate_machining_time_sync(
    gcode: &str,
    config: &MachineConfig,
) -> Result<MachiningStatistics, String> {
    validate_config(config)?;

    let mut stats = MachiningStatistics::default();
    let mut blocks = parse_motion_blocks(gcode, config, &mut stats)?;
    if blocks.is_empty() {
        stats.total_time_sec = stats.static_delay_sec;
        return Ok(stats);
    }

    apply_junction_limits(&mut blocks, config, &mut stats);
    apply_lookahead(&mut blocks);
    integrate_time(&blocks, &mut stats);
    stats.total_time_sec += stats.static_delay_sec;
    stats.max_achieved_velocity *= 60.0;

    Ok(stats)
}

fn validate_config(config: &MachineConfig) -> Result<(), String> {
    if config.max_v_x <= 0.0 || config.max_v_y <= 0.0 || config.max_v_z <= 0.0 {
        return Err("machine max velocities must be positive".to_string());
    }
    if config.max_a_x <= 0.0 || config.max_a_y <= 0.0 || config.max_a_z <= 0.0 {
        return Err("machine accelerations must be positive".to_string());
    }
    if config.junction_deviation < 0.0 {
        return Err("junction deviation cannot be negative".to_string());
    }
    Ok(())
}

fn parse_motion_blocks(
    gcode: &str,
    config: &MachineConfig,
    stats: &mut MachiningStatistics,
) -> Result<Vec<MotionBlock>, String> {
    let mut state = ParserState::default();
    let mut blocks = Vec::with_capacity(gcode.len() / 18);

    for (line_index, raw_line) in gcode.lines().enumerate() {
        let clean_line = strip_comments(raw_line);
        let tokens = tokenize(&clean_line);
        if tokens.is_empty() {
            continue;
        }

        let mut next = state;
        let mut has_motion_axis = false;
        let mut arc_i: Option<f64> = None;
        let mut arc_j: Option<f64> = None;
        let mut arc_r: Option<f64> = None;

        for (letter, raw_value) in tokens {
            match letter {
                'G' => match raw_value.round() as i32 {
                    0 => next.motion_mode = MotionMode::Rapid,
                    1 => next.motion_mode = MotionMode::Linear,
                    2 => next.motion_mode = MotionMode::ArcCw,
                    3 => next.motion_mode = MotionMode::ArcCcw,
                    20 => next.unit_scale = 25.4,
                    21 => next.unit_scale = 1.0,
                    90 => next.absolute = true,
                    91 => next.absolute = false,
                    17 | 18 | 19 => {}
                    _ => {}
                },
                'X' => {
                    next.x = resolve_axis(state.x, raw_value, next);
                    has_motion_axis = true;
                }
                'Y' => {
                    next.y = resolve_axis(state.y, raw_value, next);
                    has_motion_axis = true;
                }
                'Z' => {
                    next.z = resolve_axis(state.z, raw_value, next);
                    has_motion_axis = true;
                }
                'I' => arc_i = Some(raw_value * next.unit_scale),
                'J' => arc_j = Some(raw_value * next.unit_scale),
                'R' => arc_r = Some(raw_value * next.unit_scale),
                'F' => {
                    if raw_value > 0.0 {
                        next.feed_mm_per_min = raw_value * next.unit_scale;
                    }
                }
                'M' => {
                    let code = raw_value.round() as i32;
                    if matches!(code, 3 | 4 | 5) {
                        stats.m_command_toggles += 1;
                        stats.static_delay_sec += 2.0;
                    }
                }
                'P' => {}
                _ => {}
            }
        }

        if let Some(dwell_sec) = extract_dwell_seconds(&clean_line) {
            stats.static_delay_sec += dwell_sec;
        }

        if has_motion_axis {
            let start = Point3 {
                x: state.x,
                y: state.y,
                z: state.z,
            };
            let end = Point3 {
                x: next.x,
                y: next.y,
                z: next.z,
            };

            match next.motion_mode {
                MotionMode::ArcCw | MotionMode::ArcCcw => {
                    stats.arc_segments += 1;
                    let arc_blocks = linearize_arc(
                        start,
                        end,
                        next.motion_mode,
                        arc_i,
                        arc_j,
                        arc_r,
                        next.feed_mm_per_min,
                        config,
                        line_index + 1,
                    )?;
                    for block in arc_blocks {
                        record_block(block, stats, &mut blocks);
                    }
                }
                MotionMode::Rapid | MotionMode::Linear => {
                    if let Some(block) =
                        make_block(start, end, next.motion_mode == MotionMode::Rapid, next.feed_mm_per_min, config)
                    {
                        record_block(block, stats, &mut blocks);
                    }
                }
            }
        }

        state = next;
    }

    Ok(blocks)
}

fn record_block(block: MotionBlock, stats: &mut MachiningStatistics, blocks: &mut Vec<MotionBlock>) {
    stats.total_blocks += 1;
    stats.total_distance_mm += block.distance;
    if block.is_z_plunge {
        stats.z_plunges += 1;
    }
    if block.is_rapid {
        stats.rapid_distance_mm += block.distance;
    } else {
        stats.cutting_distance_mm += block.distance;
    }
    blocks.push(block);
}

fn make_block(
    start: Point3,
    end: Point3,
    is_rapid: bool,
    feed_mm_per_min: f64,
    config: &MachineConfig,
) -> Option<MotionBlock> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let dz = end.z - start.z;
    let distance = (dx * dx + dy * dy + dz * dz).sqrt();
    if distance <= 0.000001 {
        return None;
    }

    let requested_velocity = if is_rapid {
        f64::INFINITY
    } else {
        (feed_mm_per_min / 60.0).max(0.001)
    };
    let target_velocity = requested_velocity.min(axis_velocity_limit(dx, dy, dz, distance, config));
    let acceleration = axis_acceleration_limit(dx, dy, dz, distance, config);

    Some(MotionBlock {
        dx,
        dy,
        dz,
        distance,
        is_rapid,
        is_z_plunge: dz < -0.001 && dx.abs() < 0.001 && dy.abs() < 0.001,
        target_velocity,
        max_entry_speed: target_velocity,
        entry_speed: 0.0,
        exit_speed: 0.0,
        acceleration,
    })
}

fn axis_velocity_limit(
    dx: f64,
    dy: f64,
    dz: f64,
    distance: f64,
    config: &MachineConfig,
) -> f64 {
    let mut limit = f64::INFINITY;
    limit = limit.min(axis_component_limit(dx, distance, config.max_v_x / 60.0));
    limit = limit.min(axis_component_limit(dy, distance, config.max_v_y / 60.0));
    limit = limit.min(axis_component_limit(dz, distance, config.max_v_z / 60.0));
    limit
}

fn axis_acceleration_limit(
    dx: f64,
    dy: f64,
    dz: f64,
    distance: f64,
    config: &MachineConfig,
) -> f64 {
    let mut limit = f64::INFINITY;
    limit = limit.min(axis_component_limit(dx, distance, config.max_a_x));
    limit = limit.min(axis_component_limit(dy, distance, config.max_a_y));
    limit = limit.min(axis_component_limit(dz, distance, config.max_a_z));
    limit.max(0.001)
}

fn axis_component_limit(delta: f64, distance: f64, axis_limit: f64) -> f64 {
    let component = delta.abs() / distance;
    if component <= 0.000001 {
        f64::INFINITY
    } else {
        axis_limit / component
    }
}

fn apply_junction_limits(
    blocks: &mut [MotionBlock],
    config: &MachineConfig,
    stats: &mut MachiningStatistics,
) {
    if blocks.is_empty() {
        return;
    }

    blocks[0].max_entry_speed = 0.0;
    for index in 1..blocks.len() {
        let limit = junction_velocity(&blocks[index - 1], &blocks[index], config);
        blocks[index].max_entry_speed = limit.min(blocks[index].target_velocity);
        if blocks[index].max_entry_speed + 0.001 < blocks[index].target_velocity {
            stats.velocity_limited_corners += 1;
        }
    }
}

fn junction_velocity(previous: &MotionBlock, current: &MotionBlock, config: &MachineConfig) -> f64 {
    if config.junction_deviation <= 0.0 {
        return 0.0;
    }

    let dot = ((previous.dx * current.dx) + (previous.dy * current.dy) + (previous.dz * current.dz))
        / (previous.distance * current.distance);
    let dot = dot.clamp(-1.0, 1.0);
    let neg_dot = -dot;
    let max_through_speed = previous.target_velocity.min(current.target_velocity);

    if neg_dot < -0.999_999 {
        return max_through_speed;
    }
    if neg_dot > 0.999_999 {
        return 0.0;
    }

    let sin_theta_d2 = (0.5 * (1.0 - neg_dot)).sqrt();
    if sin_theta_d2 >= 0.999_999 {
        return 0.0;
    }

    let accel = previous.acceleration.min(current.acceleration);
    let limit = (accel * config.junction_deviation * sin_theta_d2 / (1.0 - sin_theta_d2)).sqrt();
    limit.min(max_through_speed)
}

fn apply_lookahead(blocks: &mut [MotionBlock]) {
    let mut next_entry_limit: f64 = 0.0;
    for index in (0..blocks.len()).rev() {
        let block = &mut blocks[index];
        block.exit_speed = next_entry_limit.min(block.target_velocity);
        let allowed_entry =
            (block.exit_speed * block.exit_speed + 2.0 * block.acceleration * block.distance).sqrt();
        block.entry_speed = block
            .max_entry_speed
            .min(block.target_velocity)
            .min(allowed_entry);
        next_entry_limit = block.entry_speed;
    }

    let mut previous_exit: f64 = 0.0;
    for index in 0..blocks.len() {
        let allowed_exit = {
            let block = &mut blocks[index];
            block.entry_speed = previous_exit.min(block.target_velocity);
            (block.entry_speed * block.entry_speed + 2.0 * block.acceleration * block.distance).sqrt()
        };

        let next_entry = if index + 1 < blocks.len() {
            blocks[index + 1].entry_speed
        } else {
            0.0
        };
        blocks[index].exit_speed = allowed_exit
            .min(blocks[index].target_velocity)
            .min(next_entry);
        previous_exit = blocks[index].exit_speed;
    }
}

fn integrate_time(blocks: &[MotionBlock], stats: &mut MachiningStatistics) {
    for block in blocks {
        let vc = block.target_velocity.max(block.entry_speed).max(block.exit_speed);
        let acceleration = block.acceleration.max(0.001);
        if vc <= 0.000001 {
            continue;
        }

        let d_accel = ((vc * vc - block.entry_speed * block.entry_speed) / (2.0 * acceleration)).max(0.0);
        let d_decel = ((vc * vc - block.exit_speed * block.exit_speed) / (2.0 * acceleration)).max(0.0);

        let (time, v_peak) = if d_accel + d_decel <= block.distance {
            let cruise_distance = (block.distance - d_accel - d_decel).max(0.0);
            let t_accel = ((vc - block.entry_speed) / acceleration).max(0.0);
            let t_decel = ((vc - block.exit_speed) / acceleration).max(0.0);
            (t_accel + cruise_distance / vc + t_decel, vc)
        } else {
            let v_peak_sq = (2.0 * acceleration * block.distance
                + block.entry_speed * block.entry_speed
                + block.exit_speed * block.exit_speed)
                * 0.5;
            let v_peak = v_peak_sq.max(0.0).sqrt().min(vc);
            let t_accel = ((v_peak - block.entry_speed) / acceleration).max(0.0);
            let t_decel = ((v_peak - block.exit_speed) / acceleration).max(0.0);
            (t_accel + t_decel, v_peak)
        };

        stats.max_achieved_velocity = stats.max_achieved_velocity.max(v_peak);
        stats.total_time_sec += time;
        if block.is_rapid {
            stats.rapid_time_sec += time;
        } else {
            stats.cutting_time_sec += time;
        }
    }
}

fn linearize_arc(
    start: Point3,
    end: Point3,
    mode: MotionMode,
    arc_i: Option<f64>,
    arc_j: Option<f64>,
    arc_r: Option<f64>,
    feed_mm_per_min: f64,
    config: &MachineConfig,
    line_number: usize,
) -> Result<Vec<MotionBlock>, String> {
    let center = if let (Some(i), Some(j)) = (arc_i, arc_j) {
        Point3 {
            x: start.x + i,
            y: start.y + j,
            z: start.z,
        }
    } else if let Some(radius) = arc_r {
        derive_radius_arc_center(start, end, radius, mode)
            .ok_or_else(|| format!("invalid R arc on line {line_number}"))?
    } else {
        return Ok(make_block(start, end, false, feed_mm_per_min, config)
            .into_iter()
            .collect());
    };

    let radius = ((start.x - center.x).powi(2) + (start.y - center.y).powi(2)).sqrt();
    if radius <= 0.000001 {
        return Ok(make_block(start, end, false, feed_mm_per_min, config)
            .into_iter()
            .collect());
    }

    let start_angle = (start.y - center.y).atan2(start.x - center.x);
    let end_angle = (end.y - center.y).atan2(end.x - center.x);
    let mut sweep = end_angle - start_angle;
    if mode == MotionMode::ArcCw && sweep >= 0.0 {
        sweep -= std::f64::consts::TAU;
    }
    if mode == MotionMode::ArcCcw && sweep <= 0.0 {
        sweep += std::f64::consts::TAU;
    }

    let arc_length = radius * sweep.abs();
    let chord_step = 0.25f64;
    let segment_count = (arc_length / chord_step).ceil().clamp(8.0, 20_000.0) as usize;
    let mut previous = start;
    let mut blocks = Vec::with_capacity(segment_count);

    for index in 1..=segment_count {
        let t = index as f64 / segment_count as f64;
        let angle = start_angle + sweep * t;
        let point = Point3 {
            x: center.x + angle.cos() * radius,
            y: center.y + angle.sin() * radius,
            z: start.z + (end.z - start.z) * t,
        };
        if let Some(block) = make_block(previous, point, false, feed_mm_per_min, config) {
            blocks.push(block);
        }
        previous = point;
    }

    Ok(blocks)
}

fn derive_radius_arc_center(
    start: Point3,
    end: Point3,
    radius: f64,
    mode: MotionMode,
) -> Option<Point3> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let chord = (dx * dx + dy * dy).sqrt();
    let abs_radius = radius.abs();
    if chord <= 0.000001 || abs_radius < chord * 0.5 {
        return None;
    }

    let midpoint_x = (start.x + end.x) * 0.5;
    let midpoint_y = (start.y + end.y) * 0.5;
    let h = (abs_radius * abs_radius - (chord * 0.5).powi(2)).sqrt();
    let nx = -dy / chord;
    let ny = dx / chord;
    let side = if (mode == MotionMode::ArcCw) ^ (radius < 0.0) {
        -1.0
    } else {
        1.0
    };

    Some(Point3 {
        x: midpoint_x + nx * h * side,
        y: midpoint_y + ny * h * side,
        z: start.z,
    })
}

fn resolve_axis(current: f64, value: f64, state: ParserState) -> f64 {
    let scaled = value * state.unit_scale;
    if state.absolute {
        scaled
    } else {
        current + scaled
    }
}

fn extract_dwell_seconds(clean_line: &str) -> Option<f64> {
    let tokens = tokenize(clean_line);
    let has_g4 = tokens
        .iter()
        .any(|(letter, value)| *letter == 'G' && value.round() as i32 == 4);
    if !has_g4 {
        return None;
    }

    for (letter, value) in tokens {
        if letter == 'P' && value > 0.0 {
            return Some(value);
        }
    }
    None
}

fn strip_comments(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let mut in_paren_comment = false;

    for ch in line.chars() {
        match ch {
            ';' if !in_paren_comment => break,
            '(' => in_paren_comment = true,
            ')' => in_paren_comment = false,
            _ if !in_paren_comment => result.push(ch),
            _ => {}
        }
    }

    result
}

fn tokenize(line: &str) -> Vec<(char, f64)> {
    let mut tokens = Vec::new();
    let mut letter: Option<char> = None;
    let mut value = String::new();

    for ch in line.chars() {
        if ch.is_ascii_alphabetic() {
            push_token(&mut tokens, &mut letter, &mut value);
            letter = Some(ch.to_ascii_uppercase());
        } else if letter.is_some() && !ch.is_whitespace() {
            value.push(ch);
        } else if ch.is_whitespace() {
            push_token(&mut tokens, &mut letter, &mut value);
        }
    }
    push_token(&mut tokens, &mut letter, &mut value);

    tokens
}

fn push_token(tokens: &mut Vec<(char, f64)>, letter: &mut Option<char>, value: &mut String) {
    let Some(current_letter) = letter.take() else {
        value.clear();
        return;
    };
    if let Ok(parsed) = value.parse::<f64>() {
        tokens.push((current_letter, parsed));
    }
    value.clear();
}
