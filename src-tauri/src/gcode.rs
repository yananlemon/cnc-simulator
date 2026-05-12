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
    let z_count = input
        .lines()
        .take(1000)
        .filter(|l| {
            let upper = l.to_uppercase();
            let comment_pos = upper
                .find(';')
                .or_else(|| upper.find('('))
                .unwrap_or(upper.len());
            upper[..comment_pos]
                .split_whitespace()
                .any(|t| t.starts_with('Z'))
        })
        .count();

    if z_count > 5 {
        is_laser_mode = false;
    }

    let mut max_s = 1000.0;
    if is_laser_mode {
        let header = &input[0..(input.len().min(2048))];
        if let Some(idx) = header.find("S-Max:") {
            if let Some(val_str) = header[idx + 6..].split_whitespace().next() {
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

#[cfg(test)]
mod tests {
    use super::*;

    // 1. 空输入返回空段列表，不应 panic
    #[test]
    fn empty_input_returns_empty_segments() {
        let result = parse_gcode("").unwrap();
        assert!(result.segments.is_empty(), "空输入不应产生任何运动段");
        // 空段列表时，包围盒被重置为全零原点
        assert_eq!(result.min.x, 0.0);
        assert_eq!(result.min.y, 0.0);
        assert_eq!(result.min.z, 0.0);
        assert_eq!(result.max.x, 0.0);
        assert_eq!(result.max.y, 0.0);
        assert_eq!(result.max.z, 0.0);
    }

    // 2. G0 快速移动不产生切削段（rapid=true），G1 产生切削段（rapid=false）
    #[test]
    fn g0_is_rapid_g1_is_cutting() {
        let result = parse_gcode("G0 X10 Y0\nG1 X20 Y0").unwrap();
        assert_eq!(result.segments.len(), 2, "应产生两个运动段");
        // 第一段 G0：rapid=true
        assert!(result.segments[0].rapid, "G0 段应为快速移动");
        // 第二段 G1：rapid=false
        assert!(!result.segments[1].rapid, "G1 段应为切削运动");
        // 验证坐标正确
        assert!((result.segments[0].end.x - 10.0).abs() < 1e-9);
        assert!((result.segments[1].end.x - 20.0).abs() < 1e-9);
    }

    // 3. G20 英制单位：坐标乘以 25.4 转换为毫米
    #[test]
    fn inch_mode_g20_scales_coordinates() {
        // G20 先设置英制模式，再 G1 X1 Y1 → 实际 25.4mm
        let result = parse_gcode("G20\nG1 X1 Y1").unwrap();
        assert_eq!(result.segments.len(), 1, "应产生一个切削段");
        let end = &result.segments[0].end;
        assert!(
            (end.x - 25.4).abs() < 1e-9,
            "英制 X1 应转换为 25.4mm，实际 {}",
            end.x
        );
        assert!(
            (end.y - 25.4).abs() < 1e-9,
            "英制 Y1 应转换为 25.4mm，实际 {}",
            end.y
        );
    }

    // 4. G91 相对模式：每行坐标在前次终点基础上累加
    #[test]
    fn relative_mode_g91_accumulates() {
        let result = parse_gcode("G91\nG1 X10 Y0\nG1 X10 Y0").unwrap();
        assert_eq!(result.segments.len(), 2, "应产生两个运动段");
        // 第一段：从 X=0 移动 +10，终点 X=10
        assert!(
            (result.segments[0].end.x - 10.0).abs() < 1e-9,
            "第一段终点 X 应为 10，实际 {}",
            result.segments[0].end.x
        );
        // 第二段：在 X=10 基础上再 +10，终点 X=20
        assert!(
            (result.segments[1].end.x - 20.0).abs() < 1e-9,
            "第二段终点 X 应为 20（累加），实际 {}",
            result.segments[1].end.x
        );
    }

    // 5. 分号注释和括号注释均被正确剥离，剩余坐标仍被解析
    #[test]
    fn comments_are_stripped() {
        let gcode = "G1 X10 Y0 ; 这是分号注释\nG1 X20 (括号注释) Y5";
        let result = parse_gcode(gcode).unwrap();
        assert_eq!(result.segments.len(), 2, "注释剥离后应有两段");
        // 第一段：X10（分号后被剥离，不影响坐标）
        assert!((result.segments[0].end.x - 10.0).abs() < 1e-9);
        // 第二段：括号内注释被剥离，X20 Y5 正常解析
        assert!((result.segments[1].end.x - 20.0).abs() < 1e-9);
        assert!((result.segments[1].end.y - 5.0).abs() < 1e-9);
    }

    // 6. 包围盒正确跟踪所有运动点的 min/max x/y/z
    #[test]
    fn bounding_box_is_tracked() {
        // 第一段：(0,0,0) → (10,5,-2)；第二段：(10,5,-2) → (0,0,0)
        let result = parse_gcode("G1 X10 Y5 Z-2\nG1 X0 Y0 Z0").unwrap();
        assert_eq!(result.segments.len(), 2);
        // min 应为 (0, 0, -2)
        assert!((result.min.x - 0.0).abs() < 1e-9, "min.x 应为 0");
        assert!((result.min.y - 0.0).abs() < 1e-9, "min.y 应为 0");
        assert!((result.min.z - (-2.0)).abs() < 1e-9, "min.z 应为 -2");
        // max 应为 (10, 5, 0)
        assert!((result.max.x - 10.0).abs() < 1e-9, "max.x 应为 10");
        assert!((result.max.y - 5.0).abs() < 1e-9, "max.y 应为 5");
        assert!((result.max.z - 0.0).abs() < 1e-9, "max.z 应为 0");
    }

    // 7. 激光模式识别：头部含 "S-Max" 且无 Z 轴命令时进入激光模式
    //    激光模式下 S 功率映射为负 Z 深度
    #[test]
    fn laser_mode_detected_by_s_max_header() {
        // 头部含 "S-Max: 1000"，无显式 Z 命令，应触发激光模式
        // S500 / max_s1000 → depth = max(0.1, 0.5*1.5) = 0.75 → z = -0.75
        let gcode = "; S-Max: 1000\nG1 X10 Y0 S500";
        let result = parse_gcode(gcode).unwrap();
        assert_eq!(result.segments.len(), 1, "应产生一个运动段");
        let z = result.segments[0].end.z;
        assert!(z < 0.0, "激光模式下 S 应映射为负 Z 深度，实际 z={z}");
        assert!(
            (z - (-0.75)).abs() < 1e-6,
            "S500/max1000 → 期望 z=-0.75，实际 z={z}"
        );
    }

    // 8. 激光模式：S 功率正确映射为 Z 深度；M5 指令将激光关闭（S 归零）
    #[test]
    fn laser_mode_s_power_maps_to_depth() {
        // S-Max=1000，S1000 → depth = max(0.1, 1.5) = 1.5 → z=-1.5
        // M5 将 S 置零 → z 归 0
        let gcode = "; S-Max: 1000\nG1 X10 Y0 S1000\nM5\nG1 X20 Y0";
        let result = parse_gcode(gcode).unwrap();
        // 验证 segments 数量：S1000段 + M5关闭段（z变化产生段）+ G1空功率段
        assert!(
            result.segments.len() >= 2,
            "应至少有 S1000 和 M5 对应的两个段"
        );
        // 第一段：S=1000 → depth=1.5 → z=-1.5
        let first_z = result.segments[0].end.z;
        assert!(
            (first_z - (-1.5)).abs() < 1e-6,
            "S1000 期望 z=-1.5，实际 z={first_z}"
        );
        // M5 关闭激光，对应段的终点 z 应归零
        let m5_seg = &result.segments[1];
        assert!(
            (m5_seg.end.z - 0.0).abs() < 1e-6,
            "M5 后 z 应归零，实际 z={}",
            m5_seg.end.z
        );
    }

    // 9. Z 轴命令数 > 5 时，即使头部含 S-Max 也退出激光模式
    #[test]
    fn laser_mode_disabled_when_many_z_commands() {
        // 6 行含 Z 命令（z_count=6 > 5），即使有 S-Max 头部也应禁用激光模式
        // 非激光模式下 Z 值为字面量，最后一段终点 z 应为 6.0（不被 S 覆盖）
        let gcode = "; S-Max: 1000\nG1 X0 Z1\nG1 X1 Z2\nG1 X2 Z3\nG1 X3 Z4\nG1 X4 Z5\nG1 X5 Z6";
        let result = parse_gcode(gcode).unwrap();
        assert!(!result.segments.is_empty(), "应有运动段");
        let last_z = result.segments.last().unwrap().end.z;
        assert!(
            (last_z - 6.0).abs() < 1e-9,
            "非激光模式下最后段 Z 应为字面值 6.0，实际 z={last_z}"
        );
    }

    // 10. 无运动轴变化的行（如仅设置进给率）不产生任何运动段
    #[test]
    fn no_segment_when_no_axis_change() {
        // G1 F100：仅设置进给率，X/Y/Z 均未变化，不应产生运动段
        let result = parse_gcode("G1 F100").unwrap();
        assert!(
            result.segments.is_empty(),
            "无轴变化不应产生段，实际有 {} 段",
            result.segments.len()
        );
        // 模式变更行（G21、G90）同样不产生段
        let result2 = parse_gcode("G21\nG90").unwrap();
        assert!(
            result2.segments.is_empty(),
            "纯模式切换不应产生段，实际有 {} 段",
            result2.segments.len()
        );
    }
}
