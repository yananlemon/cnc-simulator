use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionSegment {
    pub start: MotionPoint,
    pub end: MotionPoint,
    pub rapid: bool,
    pub feed_rate: Option<f64>,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedProgram {
    pub segments: Vec<MotionSegment>,
    pub min: MotionPoint,
    pub max: MotionPoint,
}

#[derive(Debug, Clone, Copy)]
struct ModalState {
    x: f64,
    y: f64,
    z: f64,
    s: f64,
    is_m_345: Option<i32>,
    motion_mode: MotionMode,
    feed_rate: Option<f64>,
    absolute: bool,
    unit_scale: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MotionMode {
    Rapid,
    Linear,
}

impl Default for ModalState {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            s: 0.0,
            is_m_345: None,
            motion_mode: MotionMode::Rapid,
            feed_rate: None,
            absolute: true,
            unit_scale: 1.0,
        }
    }
}

pub fn parse_gcode(input: &str) -> Result<ParsedProgram, String> {
    let header = &input[0..(input.len().min(2048))].to_lowercase();
    let is_laser_prefix = input.len() > 0 && (header.contains("laser") || header.contains("s-max"));
    let has_g1_s = input.lines().take(500).any(|l| {
        let upper = l.to_uppercase();
        upper.contains("G1") && upper.contains('S')
    });
    let mut is_laser_mode = is_laser_prefix || has_g1_s;

    // A real 3D CNC file uses Z axis frequently. Let's count Z commands in the first few hundred lines
    let z_count = input.lines().take(1000).filter(|l| {
        let upper = l.to_uppercase();
        let comment_pos = upper.find(';').or_else(|| upper.find('(')).unwrap_or(upper.len());
        upper[..comment_pos].split_whitespace().any(|t| t.starts_with('Z'))
    }).count();

    if z_count > 5 {
        is_laser_mode = false;
    }

    let mut max_s = 1000.0;
    if is_laser_mode {
        let header = &input[0..(input.len().min(2048))];
        if let Some(idx) = header.find("S-Max:") {
            if let Some(val_str) = header[idx+6..].split_whitespace().next() {
                if let Ok(v) = val_str.parse::<f64>() {
                    max_s = (v).max(1.0);
                }
            }
        }
    }

    let mut state = ModalState::default();
    let mut segments = Vec::new();
    let mut min = MotionPoint {
        x: f64::INFINITY,
        y: f64::INFINITY,
        z: f64::INFINITY,
    };
    let mut max = MotionPoint {
        x: f64::NEG_INFINITY,
        y: f64::NEG_INFINITY,
        z: f64::NEG_INFINITY,
    };

    for (index, raw_line) in input.lines().enumerate() {
        let cleaned = strip_comments(raw_line);
        if cleaned.trim().is_empty() {
            continue;
        }

        let mut next = state;
        let tokens = tokenize(&cleaned);
        let mut has_z_command = false;

        for token in tokens {
            let Some(letter) = token.chars().next() else {
                continue;
            };
            let value = token[1..]
                .parse::<f64>()
                .map_err(|_| format!("invalid numeric token `{token}` on line {}", index + 1))?;
            match letter.to_ascii_uppercase() {
                'G' => match value as i32 {
                    0 => next.motion_mode = MotionMode::Rapid,
                    1 => next.motion_mode = MotionMode::Linear,
                    20 => next.unit_scale = 25.4,
                    21 => next.unit_scale = 1.0,
                    90 => next.absolute = true,
                    91 => next.absolute = false,
                    17 | 18 | 19 => {}
                    2 | 3 => {
                        return Err(format!(
                            "arc motion (G2/G3) is not yet supported in line {}",
                            index + 1
                        ));
                    }
                    _ => {}
                },
                'X' => {
                    next.x = resolve_axis(state.x, value, next);
                }
                'Y' => {
                    next.y = resolve_axis(state.y, value, next);
                }
                'Z' => {
                    next.z = resolve_axis(state.z, value, next);
                    has_z_command = true;
                }
                'F' => next.feed_rate = Some(value),
                'S' => next.s = value,
                'M' => {
                    if value as i32 == 3 || value as i32 == 4 || value as i32 == 5 {
                        next.is_m_345 = Some(value as i32);
                    }
                }
                _ => {}
            }
        }

        let mut saw_motion_axis = next.x != state.x || next.y != state.y || next.z != state.z;

        if is_laser_mode && !has_z_command {
            if Some(5) == next.is_m_345 {
                next.s = 0.0;
            }
            if next.s > 0.0 && next.motion_mode == MotionMode::Linear {
                let s_val = next.s.min(max_s);
                let depth = 0.1f64.max((s_val / max_s) * 1.5);
                next.z = -depth;
            } else {
                next.z = 0.0;
            }
            if next.z != state.z || next.s != state.s {
                saw_motion_axis = true;
            }
        }

        if saw_motion_axis {
            let start = MotionPoint {
                x: state.x,
                y: state.y,
                z: state.z,
            };
            let end = MotionPoint {
                x: next.x,
                y: next.y,
                z: next.z,
            };
            accumulate_bounds(&start, &mut min, &mut max);
            accumulate_bounds(&end, &mut min, &mut max);
            segments.push(MotionSegment {
                start,
                end,
                rapid: next.motion_mode == MotionMode::Rapid,
                feed_rate: next.feed_rate,
                line_number: index + 1,
            });
        }

        state = next;
    }

    if segments.is_empty() {
        min = MotionPoint {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        };
        max = MotionPoint {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        };
    }

    Ok(ParsedProgram { segments, min, max })
}

fn resolve_axis(current: f64, value: f64, state: ModalState) -> f64 {
    let scaled = value * state.unit_scale;
    if state.absolute {
        scaled
    } else {
        current + scaled
    }
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

fn tokenize(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in line.chars() {
        if ch.is_ascii_alphabetic() {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            current.push(ch);
        } else if !ch.is_whitespace() {
            current.push(ch);
        } else if !current.is_empty() {
            tokens.push(current.clone());
            current.clear();
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn accumulate_bounds(point: &MotionPoint, min: &mut MotionPoint, max: &mut MotionPoint) {
    min.x = min.x.min(point.x);
    min.y = min.y.min(point.y);
    min.z = min.z.min(point.z);
    max.x = max.x.max(point.x);
    max.y = max.y.max(point.y);
    max.z = max.z.max(point.z);
}
