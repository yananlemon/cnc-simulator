mod gcode;
mod simulation;

use serde::Serialize;
use simulation::{export_stl, run_simulation, SimulationRequest, SimulationResult};

#[derive(Serialize)]
struct HealthStatus {
    name: String,
    version: String,
    status: String,
}

#[derive(Serialize)]
struct ParseSummary {
    segment_count: usize,
    min_x: f64,
    min_y: f64,
    min_z: f64,
    max_x: f64,
    max_y: f64,
    max_z: f64,
}

#[tauri::command]
fn app_health() -> HealthStatus {
    HealthStatus {
        name: "CNC Simulator".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: "ready".to_string(),
    }
}

#[tauri::command]
fn parse_gcode_overview(gcode: String) -> Result<ParseSummary, String> {
    let parsed = gcode::parse_gcode(&gcode)?;
    Ok(ParseSummary {
        segment_count: parsed.segments.len(),
        min_x: parsed.min.x,
        min_y: parsed.min.y,
        min_z: parsed.min.z,
        max_x: parsed.max.x,
        max_y: parsed.max.y,
        max_z: parsed.max.z,
    })
}

#[tauri::command]
fn simulate_gcode(request: SimulationRequest) -> Result<SimulationResult, String> {
    run_simulation(&request)
}

#[tauri::command]
fn export_simulated_stl(request: SimulationRequest) -> Result<String, String> {
    export_stl(&request)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_health,
            parse_gcode_overview,
            simulate_gcode,
            export_simulated_stl
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CNC Simulator");
}
