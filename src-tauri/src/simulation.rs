use crate::gcode::{MotionPoint, MotionSegment, ParsedProgram};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolType {
    BallNose,
    FlatEndMill,
    VBit,
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
        let dx = segment.end.x - segment.start.x;
        let dy = segment.end.y - segment.start.y;
        let dz = segment.end.z - segment.start.z;
        let length = (dx * dx + dy * dy + dz * dz).sqrt();

        let step = derive_path_step(self.resolution_mm, tool);
        let samples = ((length / step).ceil() as usize).max(1);

        let mut affected = 0;
        for index in 0..=samples {
            let t = index as f64 / samples as f64;
            let point = MotionPoint {
                x: segment.start.x + dx * t,
                y: segment.start.y + dy * t,
                z: segment.start.z + dz * t,
            };
            affected += self.apply_tool_at_point(&point, tool)?;
        }
        Ok(affected)
    }

    fn apply_tool_at_point(&mut self, point: &MotionPoint, tool: &ToolSpec) -> Result<usize, String> {
        let radius = tool.diameter_mm * 0.5;
        if radius <= 0.0 {
            return Err("tool diameter must be positive".to_string());
        }

        let local_x = point.x - self.origin_x_mm;
        let local_y = point.y - self.origin_y_mm;
        let col_center = (local_x / self.resolution_mm).round() as isize;
        let row_center = (local_y / self.resolution_mm).round() as isize;
        let reach = (radius / self.resolution_mm).ceil() as isize + 1;
        let mut touched = 0usize;

        for row in (row_center - reach)..=(row_center + reach) {
            if row < 0 || row >= self.rows as isize {
                continue;
            }
            for col in (col_center - reach)..=(col_center + reach) {
                if col < 0 || col >= self.cols as isize {
                    continue;
                }
                let world_x = self.origin_x_mm + col as f64 * self.resolution_mm;
                let world_y = self.origin_y_mm + row as f64 * self.resolution_mm;
                let cut_height = match compute_cell_cut_surface(
                    point,
                    tool,
                    world_x,
                    world_y,
                    self.resolution_mm,
                )? {
                    Some(height) => height,
                    None => continue,
                };
                let cell = &mut self.data[row as usize * self.cols + col as usize];
                if cut_height < *cell as f64 {
                    *cell = cut_height.max(-self.thickness_mm) as f32;
                    touched += 1;
                }
            }
        }

        Ok(touched)
    }
}

fn compute_cut_surface(z_tip: f64, radial: f64, tool: &ToolSpec) -> Result<f64, String> {
    match tool.tool_type {
        ToolType::FlatEndMill => Ok(z_tip),
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
            Ok(z_tip + radial / half_angle)
        }
    }
}

fn compute_flat_cell_cut_surface(
    segment: &MotionSegment,
    center_x: f64,
    center_y: f64,
    resolution_mm: f64,
    radius: f64,
) -> Option<f64> {
    let quarter = resolution_mm * 0.25;
    let edge = resolution_mm * 0.4;
    let sample_offsets = [
        (0.0, 0.0),
        (-quarter, -quarter),
        (quarter, -quarter),
        (-quarter, quarter),
        (quarter, quarter),
        (-edge, 0.0),
        (edge, 0.0),
        (0.0, -edge),
        (0.0, edge),
    ];

    let seg_dx = segment.end.x - segment.start.x;
    let seg_dy = segment.end.y - segment.start.y;
    let seg_len2 = seg_dx * seg_dx + seg_dy * seg_dy;
    let seg_dz = segment.end.z - segment.start.z;

    let mut best: Option<f64> = None;
    for (ox, oy) in sample_offsets {
        let sample_x = center_x + ox;
        let sample_y = center_y + oy;

        let t = if seg_len2 <= f64::EPSILON {
            0.0
        } else {
            let px = sample_x - segment.start.x;
            let py = sample_y - segment.start.y;
            ((px * seg_dx + py * seg_dy) / seg_len2).clamp(0.0, 1.0)
        };

        let closest_x = segment.start.x + seg_dx * t;
        let closest_y = segment.start.y + seg_dy * t;
        let dx = sample_x - closest_x;
        let dy = sample_y - closest_y;
        let radial = (dx * dx + dy * dy).sqrt();
        if radial > radius {
            continue;
        }

        let z_tip = segment.start.z + seg_dz * t;
        best = Some(match best {
            Some(current) => current.min(z_tip),
            None => z_tip,
        });
    }

    best
}

fn compute_cell_cut_surface(
    point: &MotionPoint,
    tool: &ToolSpec,
    center_x: f64,
    center_y: f64,
    resolution_mm: f64,
) -> Result<Option<f64>, String> {
    let radius = tool.diameter_mm * 0.5;
    let quarter = resolution_mm * 0.25;
    let edge = resolution_mm * 0.4;
    let sample_offsets = [
        (0.0, 0.0),
        (-quarter, -quarter),
        (quarter, -quarter),
        (-quarter, quarter),
        (quarter, quarter),
        (-edge, 0.0),
        (edge, 0.0),
        (0.0, -edge),
        (0.0, edge),
    ];

    let mut best: Option<f64> = None;
    for (ox, oy) in sample_offsets {
        let sample_x = center_x + ox;
        let sample_y = center_y + oy;
        let dx = sample_x - point.x;
        let dy = sample_y - point.y;
        let radial = (dx * dx + dy * dy).sqrt();
        if radial > radius {
            continue;
        }

        let cut = compute_cut_surface(point.z, radial, tool)?;
        best = Some(match best {
            Some(current) => current.min(cut),
            None => cut,
        });
    }

    Ok(best)
}

fn derive_effective_resolution(stock: &StockSpec, tool: &ToolSpec) -> f64 {
    stock.resolution_mm.min(tool.diameter_mm / 20.0).clamp(0.02, 0.5)
}

fn derive_path_step(resolution_mm: f64, tool: &ToolSpec) -> f64 {
    let resolution_target = (resolution_mm * 0.16).clamp(0.01, 0.04);
    let tool_target = (tool.diameter_mm * 0.035).clamp(0.01, 0.05);
    resolution_target.min(tool_target)
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

pub fn export_stl(request: &SimulationRequest) -> Result<String, String> {
    let program = crate::gcode::parse_gcode(&request.gcode)?;
    let mut effective_stock = request.stock.clone();
    effective_stock.resolution_mm = derive_effective_resolution(&request.stock, &request.tool);
    let mut field = HeightField::new(&effective_stock)?;
    field.simulate(&program, &request.tool)?;
    Ok(field.export_ascii_stl("artimaker_stock"))
}
