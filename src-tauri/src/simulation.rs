use crate::gcode::{MotionSegment, ParsedProgram};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockSpec {
    pub width_mm: f64,
    pub height_mm: f64,
    pub thickness_mm: f64,
    pub resolution_mm: f64,
    #[serde(default)]
    pub origin_x_mm: f64,
    #[serde(default)]
    pub origin_y_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub tool_type: ToolType,
    pub diameter_mm: f64,
    pub angle_deg: Option<f64>,
    #[serde(default)]
    pub tip_diameter_mm: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolType {
    BallNose,
    FlatEndMill,
    VBit,
    Laser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationRequest {
    pub gcode: String,
    pub stock: StockSpec,
    pub tool: ToolSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationSummary {
    pub width_mm: f64,
    pub height_mm: f64,
    pub thickness_mm: f64,
    pub resolution_mm: f64,
    pub grid_width: usize,
    pub grid_height: usize,
    pub removed_volume_mm3: f64,
    pub min_height_mm: f64,
    pub max_height_mm: f64,
    pub segment_count: usize,
    pub cutting_segment_count: usize,
    pub estimated_cut_pixels: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub summary: SimulationSummary,
    pub heights: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationJobResult {
    pub job_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationTile {
    pub job_id: u64,
    pub start_row: usize,
    pub row_count: usize,
    pub heights: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct HeightField {
    cols: usize,
    rows: usize,
    resolution_mm: f64,
    width_mm: f64,
    height_mm: f64,
    thickness_mm: f64,
    origin_x_mm: f64,
    origin_y_mm: f64,
    data: Vec<f32>,
}

impl HeightField {
    pub fn new(stock: &StockSpec) -> Result<Self, String> {
        if stock.width_mm <= 0.0 || stock.height_mm <= 0.0 || stock.thickness_mm <= 0.0 {
            return Err("stock dimensions must be positive".to_string());
        }
        if stock.resolution_mm <= 0.0 {
            return Err("simulation resolution must be positive".to_string());
        }

        let cols = ((stock.width_mm / stock.resolution_mm).ceil() as usize).max(2) + 1;
        let rows = ((stock.height_mm / stock.resolution_mm).ceil() as usize).max(2) + 1;
        Ok(Self {
            cols,
            rows,
            resolution_mm: stock.resolution_mm,
            width_mm: stock.width_mm,
            height_mm: stock.height_mm,
            thickness_mm: stock.thickness_mm,
            origin_x_mm: stock.origin_x_mm,
            origin_y_mm: stock.origin_y_mm,
            data: vec![0.0; cols * rows],
        })
    }

    pub fn simulate(
        &mut self,
        program: &ParsedProgram,
        tool: &ToolSpec,
    ) -> Result<SimulationSummary, String> {
        let mut estimated_cut_pixels = 0usize;
        let mut cutting_segments = 0usize;

        for segment in &program.segments {
            if segment.rapid {
                continue;
            }
            cutting_segments += 1;
            estimated_cut_pixels += self.apply_segment(segment, tool)?;
        }

        // Apply gentle smoothing to eliminate any remaining aliasing artifacts
        // This mimics the natural smoothing that occurs in real CNC cutting
        self.apply_smoothing_filter()?;

        let mut min_height = 0.0f64;
        let mut max_height = 0.0f64;
        let mut removed_volume = 0.0f64;
        let cell_area = self.resolution_mm * self.resolution_mm;

        for height in &self.data {
            let height_f64 = *height as f64;
            min_height = min_height.min(height_f64);
            max_height = max_height.max(height_f64);
            removed_volume += (0.0 - height_f64).max(0.0) * cell_area;
        }

        Ok(SimulationSummary {
            width_mm: self.width_mm,
            height_mm: self.height_mm,
            thickness_mm: self.thickness_mm,
            resolution_mm: self.resolution_mm,
            grid_width: self.cols,
            grid_height: self.rows,
            removed_volume_mm3: removed_volume,
            min_height_mm: min_height,
            max_height_mm: max_height,
            segment_count: program.segments.len(),
            cutting_segment_count: cutting_segments,
            estimated_cut_pixels,
        })
    }

    pub fn heights(&self) -> &[f32] {
        &self.data
    }

    pub fn export_ascii_stl(&self, name: &str) -> String {
        let mut output = String::new();
        output.push_str(&format!("solid {name}\n"));

        for row in 0..(self.rows - 1) {
            for col in 0..(self.cols - 1) {
                let p00 = self.vertex(row, col);
                let p10 = self.vertex(row, col + 1);
                let p01 = self.vertex(row + 1, col);
                let p11 = self.vertex(row + 1, col + 1);

                append_triangle(&mut output, p00, p10, p11);
                append_triangle(&mut output, p00, p11, p01);
            }
        }

        output.push_str(&format!("endsolid {name}\n"));
        output
    }

    fn vertex(&self, row: usize, col: usize) -> [f32; 3] {
        let x = (col as f64 * self.resolution_mm).min(self.width_mm) as f32;
        let y = (row as f64 * self.resolution_mm).min(self.height_mm) as f32;
        let surface = self.data[row * self.cols + col] as f64;
        let z = (self.thickness_mm + surface).clamp(0.0, self.thickness_mm) as f32;
        [x, y, z]
    }

    fn apply_segment(&mut self, segment: &MotionSegment, tool: &ToolSpec) -> Result<usize, String> {
        let radius = tool.diameter_mm * 0.5;
        if radius <= 0.0 {
            return Err("tool diameter must be positive".to_string());
        }

        let mut affected = 0;

        let min_x = segment.start.x.min(segment.end.x) - radius;
        let max_x = segment.start.x.max(segment.end.x) + radius;
        let min_y = segment.start.y.min(segment.end.y) - radius;
        let max_y = segment.start.y.max(segment.end.y) + radius;

        let start_col = ((min_x - self.origin_x_mm) / self.resolution_mm).floor() as isize;
        let end_col = ((max_x - self.origin_x_mm) / self.resolution_mm).ceil() as isize;
        let start_row = ((min_y - self.origin_y_mm) / self.resolution_mm).floor() as isize;
        let end_row = ((max_y - self.origin_y_mm) / self.resolution_mm).ceil() as isize;

        let start_col = start_col.max(0).min(self.cols as isize - 1) as usize;
        let end_col = end_col.max(0).min(self.cols as isize - 1) as usize;
        let start_row = start_row.max(0).min(self.rows as isize - 1) as usize;
        let end_row = end_row.max(0).min(self.rows as isize - 1) as usize;

        for row in start_row..=end_row {
            let center_y = self.origin_y_mm + row as f64 * self.resolution_mm;
            let row_offset = row * self.cols;
            for col in start_col..=end_col {
                let center_x = self.origin_x_mm + col as f64 * self.resolution_mm;

                if let Some(cut_height) = compute_segment_cell_cut_surface(
                    segment,
                    tool,
                    center_x,
                    center_y,
                    self.resolution_mm,
                    radius,
                )? {
                    let cell = &mut self.data[row_offset + col];
                    if cut_height < *cell as f64 {
                        *cell = cut_height.max(-self.thickness_mm) as f32;
                        affected += 1;
                    }
                }
            }
        }

        Ok(affected)
    }

    fn apply_smoothing_filter(&mut self) -> Result<(), String> {
        // Apply moderate 3x3 smoothing filter to reduce aliasing while preserving accuracy
        // Only smooth cells that have been cut (negative height)
        // Use conservative blending to maintain fidelity to actual tool path
        let mut smoothed = self.data.clone();

        for row in 1..(self.rows - 1) {
            for col in 1..(self.cols - 1) {
                let idx = row * self.cols + col;

                // Skip uncut cells
                if self.data[idx] >= 0.0 {
                    continue;
                }

                // Collect 3x3 neighborhood with Gaussian-like weights
                let mut sum = 0.0f64;
                let mut weight_sum = 0.0f64;

                for dr in -1..=1 {
                    for dc in -1..=1 {
                        let neighbor_idx = ((row as isize + dr) as usize) * self.cols
                            + ((col as isize + dc) as usize);
                        let val = self.data[neighbor_idx];

                        // Gaussian-like kernel: center=4, adjacent=2, corner=1
                        let w = match (dr.abs(), dc.abs()) {
                            (0, 0) => 4.0,          // center
                            (0, 1) | (1, 0) => 2.0, // adjacent
                            _ => 1.0,               // corners
                        };

                        sum += val as f64 * w;
                        weight_sum += w;
                    }
                }

                let avg = sum / weight_sum;
                // Conservative blend: 40% smoothed, 60% original to preserve tool path accuracy
                smoothed[idx] = (avg * 0.4 + self.data[idx] as f64 * 0.6) as f32;
            }
        }

        self.data = smoothed;
        Ok(())
    }
}

fn compute_cut_surface(z_tip: f64, radial: f64, tool: &ToolSpec) -> Result<f64, String> {
    match tool.tool_type {
        ToolType::FlatEndMill => Ok(z_tip),
        ToolType::Laser => Ok(z_tip),
        ToolType::BallNose => {
            let radius = tool.diameter_mm * 0.5;
            let offset = radius - (radius * radius - radial * radial).max(0.0).sqrt();
            Ok(z_tip + offset)
        }
        ToolType::VBit => {
            let angle = tool
                .angle_deg
                .ok_or_else(|| "V-bit requires angle_deg".to_string())?;
            let half_angle = (angle.to_radians() * 0.5).tan();
            if half_angle <= 0.0 {
                return Err("V-bit angle must be positive".to_string());
            }
            let tip_radius = tool.tip_diameter_mm.unwrap_or(0.0) * 0.5;
            if radial <= tip_radius {
                Ok(z_tip)
            } else {
                Ok(z_tip + (radial - tip_radius) / half_angle)
            }
        }
    }
}

fn compute_segment_cell_cut_surface(
    segment: &MotionSegment,
    tool: &ToolSpec,
    center_x: f64,
    center_y: f64,
    resolution_mm: f64,
    radius: f64,
) -> Result<Option<f64>, String> {
    let seg_dx = segment.end.x - segment.start.x;
    let seg_dy = segment.end.y - segment.start.y;
    let seg_len2 = seg_dx * seg_dx + seg_dy * seg_dy;
    let seg_dz = segment.end.z - segment.start.z;

    let vx = segment.start.x - center_x;
    let vy = segment.start.y - center_y;

    let a = seg_len2;
    let b = 2.0 * (vx * seg_dx + vy * seg_dy);
    let c = vx * vx + vy * vy - radius * radius;

    let mut t_in = 0.0;
    let mut t_out = 1.0;

    if a <= f64::EPSILON {
        if c > 0.0 {
            return Ok(None);
        }
    } else {
        let discriminant = b * b - 4.0 * a * c;
        if discriminant < 0.0 {
            return Ok(None);
        }

        let sqrt_d = discriminant.sqrt();
        let t1 = (-b - sqrt_d) / (2.0 * a);
        let t2 = (-b + sqrt_d) / (2.0 * a);

        t_in = t1.max(0.0);
        t_out = t2.min(1.0);

        if t_in > 1.0 || t_out < 0.0 || t_in > t_out {
            return Ok(None);
        }
    }

    let t_span = t_out - t_in;
    let physical_dist = t_span * seg_len2.sqrt();

    let num_samples = match tool.tool_type {
        ToolType::FlatEndMill => 3,
        _ => {
            let step = (resolution_mm * 0.25).max(0.01);
            ((physical_dist / step).ceil() as usize).max(3).min(50)
        }
    };

    let mut best: Option<f64> = None;
    for i in 0..num_samples {
        let frac = if num_samples <= 1 {
            0.5
        } else {
            i as f64 / (num_samples - 1) as f64
        };
        let t = t_in + frac * (t_out - t_in);

        let p_z = segment.start.z + t * seg_dz;
        let dx = segment.start.x + t * seg_dx - center_x;
        let dy = segment.start.y + t * seg_dy - center_y;
        let radial = (dx * dx + dy * dy).sqrt().min(radius);

        let cut = compute_cut_surface(p_z, radial, tool)?;
        best = Some(best.unwrap_or(cut).min(cut));
    }

    // Anti-aliasing: if we found a cut, slightly soften the edge
    // This simulates the continuous nature of real cutting
    if let Some(cut_height) = best {
        if matches!(tool.tool_type, ToolType::BallNose | ToolType::VBit) {
            if let Some(edge_factor) = compute_edge_softening(segment, center_x, center_y, radius) {
                let softened = cut_height * (1.0 - edge_factor * 0.15);
                return Ok(Some(softened.max(cut_height - 0.05)));
            }
        }
    }

    Ok(best)
}

fn compute_edge_softening(
    segment: &MotionSegment,
    center_x: f64,
    center_y: f64,
    radius: f64,
) -> Option<f64> {
    // Calculate distance from cell center to tool path
    let seg_dx = segment.end.x - segment.start.x;
    let seg_dy = segment.end.y - segment.start.y;
    let seg_len2 = seg_dx * seg_dx + seg_dy * seg_dy;

    if seg_len2 < f64::EPSILON {
        return None;
    }

    let seg_len = seg_len2.sqrt();
    let nx = -seg_dy / seg_len;
    let ny = seg_dx / seg_len;

    let dx = center_x - segment.start.x;
    let dy = center_y - segment.start.y;
    let dist_to_path = (dx * nx + dy * ny).abs();

    // Cells near the tool edge (within 15% of radius) get softening
    let edge_threshold = radius * 0.85;
    if dist_to_path > edge_threshold && dist_to_path <= radius {
        let factor = (dist_to_path - edge_threshold) / (radius - edge_threshold);
        return Some(factor.min(1.0));
    }

    None
}

fn derive_effective_resolution(stock: &StockSpec, tool: &ToolSpec) -> f64 {
    // Use super-sampling for anti-aliasing: 40-50 samples across tool diameter
    // This eliminates jagged edges by capturing the continuous nature of cutting
    let supersample_resolution = tool.diameter_mm / 40.0;
    stock
        .resolution_mm
        .min(supersample_resolution)
        .clamp(0.01, 0.3)
}

fn append_triangle(output: &mut String, a: [f32; 3], b: [f32; 3], c: [f32; 3]) {
    output.push_str("  facet normal 0 0 0\n");
    output.push_str("    outer loop\n");
    output.push_str(&format!("      vertex {} {} {}\n", a[0], a[1], a[2]));
    output.push_str(&format!("      vertex {} {} {}\n", b[0], b[1], b[2]));
    output.push_str(&format!("      vertex {} {} {}\n", c[0], c[1], c[2]));
    output.push_str("    endloop\n");
    output.push_str("  endfacet\n");
}

pub fn run_simulation(request: &SimulationRequest) -> Result<SimulationResult, String> {
    let program = crate::gcode::parse_gcode(&request.gcode)?;
    let mut effective_stock = request.stock.clone();
    effective_stock.resolution_mm = derive_effective_resolution(&request.stock, &request.tool);
    let mut field = HeightField::new(&effective_stock)?;
    let summary = field.simulate(&program, &request.tool)?;
    Ok(SimulationResult {
        summary,
        heights: field.heights().to_vec(),
    })
}

pub fn extract_tile(
    result: &SimulationResult,
    start_row: usize,
    row_count: usize,
) -> Result<SimulationTile, String> {
    if row_count == 0 {
        return Err("row_count must be positive".to_string());
    }

    let grid_width = result.summary.grid_width;
    let grid_height = result.summary.grid_height;
    if start_row >= grid_height {
        return Err("start_row out of bounds".to_string());
    }

    let clamped_rows = row_count.min(grid_height - start_row);
    let start_index = start_row * grid_width;
    let end_index = start_index + clamped_rows * grid_width;

    Ok(SimulationTile {
        job_id: 0,
        start_row,
        row_count: clamped_rows,
        heights: result.heights[start_index..end_index].to_vec(),
    })
}

pub fn export_stl(request: &SimulationRequest) -> Result<String, String> {
    let program = crate::gcode::parse_gcode(&request.gcode)?;
    let mut effective_stock = request.stock.clone();
    effective_stock.resolution_mm = derive_effective_resolution(&request.stock, &request.tool);
    let mut field = HeightField::new(&effective_stock)?;
    field.simulate(&program, &request.tool)?;
    Ok(field.export_ascii_stl("artimaker_stock"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gcode::{MotionPoint, MotionSegment, ParsedProgram};

    // ——— 测试辅助构造函数 ———

    /// 创建指定尺寸（宽、高、厚）的毛坯规格，分辨率固定为 1mm
    fn make_stock(w: f64, h: f64, t: f64) -> StockSpec {
        StockSpec {
            width_mm: w,
            height_mm: h,
            thickness_mm: t,
            resolution_mm: 1.0,
            origin_x_mm: 0.0,
            origin_y_mm: 0.0,
        }
    }

    /// 创建平底铣刀（FlatEndMill）规格
    fn make_flat_tool(diameter: f64) -> ToolSpec {
        ToolSpec {
            tool_type: ToolType::FlatEndMill,
            diameter_mm: diameter,
            angle_deg: None,
            tip_diameter_mm: None,
        }
    }

    /// 创建球头刀（BallNose）规格
    fn make_ball_tool(diameter: f64) -> ToolSpec {
        ToolSpec {
            tool_type: ToolType::BallNose,
            diameter_mm: diameter,
            angle_deg: None,
            tip_diameter_mm: None,
        }
    }

    /// 创建一个运动段，start/end 坐标由参数给定
    fn make_segment(
        x0: f64,
        y0: f64,
        z0: f64,
        x1: f64,
        y1: f64,
        z1: f64,
        rapid: bool,
    ) -> MotionSegment {
        MotionSegment {
            start: MotionPoint {
                x: x0,
                y: y0,
                z: z0,
            },
            end: MotionPoint {
                x: x1,
                y: y1,
                z: z1,
            },
            rapid,
            feed_rate: None,
            line_number: 1,
        }
    }

    /// 将运动段列表包装为 ParsedProgram（包围盒使用占位值）
    fn make_program(segments: Vec<MotionSegment>) -> ParsedProgram {
        ParsedProgram {
            segments,
            min: MotionPoint {
                x: 0.0,
                y: 0.0,
                z: -10.0,
            },
            max: MotionPoint {
                x: 50.0,
                y: 50.0,
                z: 0.0,
            },
        }
    }

    // ——— 单元测试 ———

    // 1. 负或零尺寸的毛坯应返回 Err，不应崩溃
    #[test]
    fn new_height_field_rejects_invalid_dimensions() {
        // 宽度为 0
        let s1 = StockSpec {
            width_mm: 0.0,
            height_mm: 10.0,
            thickness_mm: 5.0,
            resolution_mm: 1.0,
            origin_x_mm: 0.0,
            origin_y_mm: 0.0,
        };
        assert!(HeightField::new(&s1).is_err(), "宽度为 0 应报错");

        // 高度为负数
        let s2 = StockSpec {
            width_mm: 10.0,
            height_mm: -1.0,
            thickness_mm: 5.0,
            resolution_mm: 1.0,
            origin_x_mm: 0.0,
            origin_y_mm: 0.0,
        };
        assert!(HeightField::new(&s2).is_err(), "高度为负应报错");

        // 厚度为 0
        let s3 = StockSpec {
            width_mm: 10.0,
            height_mm: 10.0,
            thickness_mm: 0.0,
            resolution_mm: 1.0,
            origin_x_mm: 0.0,
            origin_y_mm: 0.0,
        };
        assert!(HeightField::new(&s3).is_err(), "厚度为 0 应报错");

        // 分辨率为 0
        let s4 = StockSpec {
            width_mm: 10.0,
            height_mm: 10.0,
            thickness_mm: 5.0,
            resolution_mm: 0.0,
            origin_x_mm: 0.0,
            origin_y_mm: 0.0,
        };
        assert!(HeightField::new(&s4).is_err(), "分辨率为 0 应报错");
    }

    // 2. 有效毛坯创建后，高度场所有格点初始高度均为 0
    #[test]
    fn new_height_field_all_zeros() {
        let stock = make_stock(10.0, 10.0, 5.0);
        let hf = HeightField::new(&stock).unwrap();
        assert!(
            hf.heights().iter().all(|&h| h == 0.0),
            "新建高度场所有格点应初始化为 0.0"
        );
    }

    // 3. 平底铣刀切削后，刀具覆盖区域内应出现负高度（切削有效）
    #[test]
    fn flat_end_mill_cuts_negative_depth() {
        let stock = make_stock(10.0, 10.0, 5.0);
        let tool = make_flat_tool(2.0); // 直径 2mm，半径 1mm
                                        // 沿 y=5 横穿毛坯，刀尖 z=-1.0
        let seg = make_segment(0.0, 5.0, -1.0, 10.0, 5.0, -1.0, false);
        let prog = make_program(vec![seg]);
        let mut hf = HeightField::new(&stock).unwrap();
        let summary = hf.simulate(&prog, &tool).unwrap();
        assert!(summary.min_height_mm < 0.0, "切削后最小高度应为负值");
        // 切削段计数应为 1
        assert_eq!(summary.cutting_segment_count, 1, "应有 1 个切削段");
        // 移除体积应大于 0
        assert!(summary.removed_volume_mm3 > 0.0, "切削应有体积移除");
    }

    // 4. 快速移动段（rapid=true）不执行切削，高度场保持全零
    #[test]
    fn rapid_segment_does_not_cut() {
        let stock = make_stock(10.0, 10.0, 5.0);
        let tool = make_flat_tool(2.0);
        // 与切削测试相同路径，但 rapid=true
        let seg = make_segment(0.0, 5.0, -1.0, 10.0, 5.0, -1.0, true);
        let prog = make_program(vec![seg]);
        let mut hf = HeightField::new(&stock).unwrap();
        hf.simulate(&prog, &tool).unwrap();
        // 快速移动不切削，平滑滤波也跳过零值格点，高度场应保持全零
        assert!(
            hf.heights().iter().all(|&h| h == 0.0),
            "快速移动后高度场应保持全零"
        );
    }

    // 5. 球头刀切削产生的深度不超过刀尖 Z 坐标（几何保证：offset >= 0）
    #[test]
    fn ball_nose_cut_depth_bounded() {
        let stock = make_stock(20.0, 20.0, 5.0);
        let tool = make_ball_tool(4.0); // 直径 4mm，半径 2mm
                                        // 在 (10,10) 处定点切削，刀尖 z=-1.0
        let seg = make_segment(10.0, 10.0, -1.0, 10.0, 10.0, -1.0, false);
        let prog = make_program(vec![seg]);
        let mut hf = HeightField::new(&stock).unwrap();
        hf.simulate(&prog, &tool).unwrap();
        // 球头刀 offset = radius - sqrt(radius^2 - radial^2) >= 0
        // 所以 cut_height = z_tip + offset >= z_tip = -1.0
        // 平滑只会使值趋向零（升高），允许微小浮点容差
        let min_h = hf.heights().iter().cloned().fold(f32::INFINITY, f32::min);
        assert!(
            min_h as f64 >= -1.05,
            "球头刀切深不应超过刀尖 z=-1.0，实际最小高度={min_h}"
        );
    }

    // 6. simulate() 在有切削段时，removed_volume_mm3 应大于 0
    #[test]
    fn simulate_reports_nonzero_removed_volume() {
        let stock = make_stock(20.0, 20.0, 5.0);
        let tool = make_flat_tool(4.0); // 直径 4mm
                                        // 沿 y=10 横穿，刀尖 z=-1.0
        let seg = make_segment(0.0, 10.0, -1.0, 20.0, 10.0, -1.0, false);
        let prog = make_program(vec![seg]);
        let mut hf = HeightField::new(&stock).unwrap();
        let summary = hf.simulate(&prog, &tool).unwrap();
        assert!(
            summary.removed_volume_mm3 > 0.0,
            "切削后移除体积应大于 0，实际 {}",
            summary.removed_volume_mm3
        );
    }

    // 7. export_ascii_stl() 输出应包含合法的 "solid" 和 "endsolid" 头尾
    #[test]
    fn stl_export_has_solid_header() {
        let stock = make_stock(10.0, 10.0, 5.0);
        let hf = HeightField::new(&stock).unwrap();
        let stl = hf.export_ascii_stl("test_part");
        assert!(
            stl.starts_with("solid test_part"),
            "STL 应以 'solid <name>' 开头"
        );
        assert!(
            stl.contains("endsolid test_part"),
            "STL 应包含 'endsolid <name>'"
        );
        // 应包含至少一个三角面（facet）
        assert!(stl.contains("facet normal"), "STL 应包含至少一个三角面");
    }

    // 8. 平底铣刀的 compute_cut_surface：切削面等于 z_tip，与径向距离无关
    #[test]
    fn compute_cut_surface_flat_end_mill() {
        let tool = make_flat_tool(4.0);
        let z_tip = -2.5;
        // 在刀具中心（radial=0）
        let result_center = compute_cut_surface(z_tip, 0.0, &tool).unwrap();
        assert!(
            (result_center - z_tip).abs() < 1e-9,
            "平底铣刀中心切削面应等于 z_tip={z_tip}，实际 {result_center}"
        );
        // 在刀具边缘（radial=1.5mm）
        let result_edge = compute_cut_surface(z_tip, 1.5, &tool).unwrap();
        assert!(
            (result_edge - z_tip).abs() < 1e-9,
            "平底铣刀边缘切削面应等于 z_tip={z_tip}，实际 {result_edge}"
        );
    }

    // 9. 刀具切削深度超出毛坯厚度时，高度场数据应被截断（clamp 生效）
    #[test]
    fn cut_depth_clamped_to_stock_thickness() {
        let stock = make_stock(10.0, 10.0, 5.0); // 厚度 5mm
        let tool = make_flat_tool(4.0); // 直径 4mm
                                        // 刀尖 z=-100，远超毛坯厚度，apply_segment 内 clamp 至 -thickness=-5.0
        let seg = make_segment(5.0, 5.0, -100.0, 5.0, 5.0, -100.0, false);
        let prog = make_program(vec![seg]);
        let mut hf = HeightField::new(&stock).unwrap();
        hf.simulate(&prog, &tool).unwrap();
        // 所有格点高度应 >= -thickness_mm（平滑只会使值更接近零）
        let min_h = hf.heights().iter().cloned().fold(f32::INFINITY, f32::min);
        assert!(
            min_h as f64 >= -5.0 - 1e-4,
            "切削深度应被截断至毛坯厚度 5.0mm，实际最小高度={min_h:.4}"
        );
    }
}
