import sys
import re

file_path = "e:/w-code-new-os/cnc-simulator/src-tauri/src/simulation.rs"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace apply_segment
old_apply_segment = r"""    fn apply_segment(&mut self, segment: &MotionSegment, tool: &ToolSpec) -> Result<usize, String> \{
        let dx = segment\.end\.x - segment\.start\.x;
        let dy = segment\.end\.y - segment\.start\.y;
        let dz = segment\.end\.z - segment\.start\.z;
        let length = \(dx \* dx \+ dy \* dy \+ dz \* dz\)\.sqrt\(\);

        let step = derive_path_step\(self\.resolution_mm, tool\);
        let samples = \(\(length / step\)\.ceil\(\) as usize\)\.max\(1\);

        let mut affected = 0;
        for index in 0..=samples \{
            let t = index as f64 / samples as f64;
            let point = MotionPoint \{
                x: segment\.start\.x \+ dx \* t,
                y: segment\.start\.y \+ dy \* t,
                z: segment\.start\.z \+ dz \* t,
            \};
            affected \+= self\.apply_tool_at_point\(&point, tool\)\?;
        \}
        Ok\(affected\)
    \}"""

new_apply_segment = """    fn apply_segment(&mut self, segment: &MotionSegment, tool: &ToolSpec) -> Result<usize, String> {
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
    }"""

content = re.sub(old_apply_segment.replace('\n', '\r\n'), new_apply_segment, content)
content = re.sub(old_apply_segment, new_apply_segment, content)

# Now replace the helper blocks
old_helpers = r"""fn compute_flat_cell_cut_surface\(.*?fn derive_path_step\(resolution_mm: f64, tool: &ToolSpec\) -> f64 \{.*?\}"""

new_helpers = """fn compute_segment_cell_cut_surface(
    segment: &MotionSegment,
    tool: &ToolSpec,
    center_x: f64,
    center_y: f64,
    resolution_mm: f64,
    radius: f64,
) -> Result<Option<f64>, String> {
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

        let vx = segment.start.x - sample_x;
        let vy = segment.start.y - sample_y;

        let a = seg_len2;
        let b = 2.0 * (vx * seg_dx + vy * seg_dy);
        let c = vx * vx + vy * vy - radius * radius;

        if a <= f64::EPSILON {
            if c <= 0.0 {
                let r = c.max(0.0).sqrt();
                let cut1 = compute_cut_surface(segment.start.z, r, tool)?;
                let cut2 = compute_cut_surface(segment.end.z, r, tool)?;
                let bound = cut1.min(cut2);
                best = Some(best.unwrap_or(bound).min(bound));
            }
            continue;
        }

        let discriminant = b * b - 4.0 * a * c;
        if discriminant < 0.0 {
            continue;
        }

        let sqrt_d = discriminant.sqrt();
        let t1 = (-b - sqrt_d) / (2.0 * a);
        let t2 = (-b + sqrt_d) / (2.0 * a);

        let t_in = t1.max(0.0);
        let t_out = t2.min(1.0);

        if t_in > 1.0 || t_out < 0.0 || t_in > t_out {
            continue;
        }

        let t_closest = (-b / (2.0 * a)).clamp(t_in, t_out);

        for &t in &[t_in, t_out, t_closest] {
            let p_z = segment.start.z + t * seg_dz;
            
            let dx = segment.start.x + t * seg_dx - sample_x;
            let dy = segment.start.y + t * seg_dy - sample_y;
            let radial = (dx * dx + dy * dy).sqrt().min(radius);

            let cut = compute_cut_surface(p_z, radial, tool)?;
            best = Some(best.unwrap_or(cut).min(cut));
        }
    }

    Ok(best)
}

fn derive_effective_resolution(stock: &StockSpec, tool: &ToolSpec) -> f64 {
    stock.resolution_mm.min(tool.diameter_mm / 20.0).clamp(0.02, 0.5)
}"""

content = re.sub(old_helpers.replace('\n', '\r\n'), new_helpers, content, flags=re.DOTALL)
content = re.sub(old_helpers, new_helpers, content, flags=re.DOTALL)

# Delete unnecessary `apply_tool_at_point` function
old_apply_tool = r"""    fn apply_tool_at_point\(&mut self, point: &MotionPoint, tool: &ToolSpec\) -> Result<usize, String> \{.*?Ok\(touched\)\r?\n    \}"""
content = re.sub(old_apply_tool, "", content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Migration applied!")
