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
        let frac = if num_samples <= 1 { 0.5 } else { i as f64 / (num_samples - 1) as f64 };
        let t = t_in + frac * (t_out - t_in);
        
        let p_z = segment.start.z + t * seg_dz;
        let dx = segment.start.x + t * seg_dx - center_x;
        let dy = segment.start.y + t * seg_dy - center_y;
        let radial = (dx * dx + dy * dy).sqrt().min(radius);

        let cut = compute_cut_surface(p_z, radial, tool)?;
        best = Some(best.unwrap_or(cut).min(cut));
    }

    Ok(best)
}

fn derive_effective_resolution(stock: &StockSpec, tool: &ToolSpec) -> f64 {
    stock.resolution_mm.min(tool.diameter_mm / 20.0).clamp(0.02, 0.5)
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

pub fn extract_tile(result: &SimulationResult, start_row: usize, row_count: usize) -> Result<SimulationTile, String> {
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
