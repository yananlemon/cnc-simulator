mod gcode;
mod simulation;

use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex},
};
use tauri::async_runtime::spawn_blocking;
use simulation::{
    export_stl, extract_tile, run_simulation, SimulationJobResult, SimulationRequest, SimulationResult,
    SimulationTile,
};

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

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum SimulationJobStatus {
    Running { job_id: u64 },
    Completed { job_id: u64, summary: simulation::SimulationSummary },
    Failed { job_id: u64, message: String },
}

#[derive(Debug, Clone)]
enum SimulationJobEntry {
    Running,
    Completed(SimulationResult),
    Failed(String),
}

#[derive(Default)]
struct SimulationCacheState {
    next_job_id: AtomicU64,
    jobs: Arc<Mutex<HashMap<u64, SimulationJobEntry>>>,
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
async fn simulate_gcode(request: SimulationRequest) -> Result<SimulationResult, String> {
    spawn_blocking(move || run_simulation(&request))
        .await
        .map_err(|error| format!("simulation task failed: {error}"))?
}

#[tauri::command]
async fn simulate_gcode_cached(
    request: SimulationRequest,
    cache: tauri::State<'_, SimulationCacheState>,
) -> Result<SimulationJobResult, String> {
    let job_id = cache.next_job_id.fetch_add(1, Ordering::SeqCst) + 1;
    let jobs = Arc::clone(&cache.jobs);
    jobs
        .lock()
        .map_err(|_| "simulation cache lock poisoned".to_string())?
        .insert(job_id, SimulationJobEntry::Running);

    tauri::async_runtime::spawn(async move {
        let outcome = spawn_blocking(move || run_simulation(&request)).await;
        if let Ok(mut guard) = jobs.lock() {
            match outcome {
                Ok(Ok(result)) => {
                    guard.insert(job_id, SimulationJobEntry::Completed(result));
                }
                Ok(Err(message)) => {
                    guard.insert(job_id, SimulationJobEntry::Failed(message));
                }
                Err(error) => {
                    guard.insert(
                        job_id,
                        SimulationJobEntry::Failed(format!("simulation task failed: {error}")),
                    );
                }
            }
        }
    });

    Ok(SimulationJobResult { job_id })
}

#[tauri::command]
fn get_simulation_job_status(
    job_id: u64,
    cache: tauri::State<'_, SimulationCacheState>,
) -> Result<SimulationJobStatus, String> {
    let jobs = cache
        .jobs
        .lock()
        .map_err(|_| "simulation cache lock poisoned".to_string())?;
    let entry = jobs
        .get(&job_id)
        .ok_or_else(|| format!("simulation job {job_id} not found"))?;

    Ok(match entry {
        SimulationJobEntry::Running => SimulationJobStatus::Running { job_id },
        SimulationJobEntry::Completed(result) => SimulationJobStatus::Completed {
            job_id,
            summary: result.summary.clone(),
        },
        SimulationJobEntry::Failed(message) => SimulationJobStatus::Failed {
            job_id,
            message: message.clone(),
        },
    })
}

#[tauri::command]
fn get_simulation_tile(
    job_id: u64,
    start_row: usize,
    row_count: usize,
    cache: tauri::State<'_, SimulationCacheState>,
) -> Result<SimulationTile, String> {
    let jobs = cache
        .jobs
        .lock()
        .map_err(|_| "simulation cache lock poisoned".to_string())?;
    let entry = jobs
        .get(&job_id)
        .ok_or_else(|| format!("simulation job {job_id} not found"))?;
    let result = match entry {
        SimulationJobEntry::Completed(result) => result,
        SimulationJobEntry::Running => return Err(format!("simulation job {job_id} still running")),
        SimulationJobEntry::Failed(message) => return Err(message.clone()),
    };
    let mut tile = extract_tile(result, start_row, row_count)?;
    tile.job_id = job_id;
    Ok(tile)
}

#[tauri::command]
fn release_simulation_job(job_id: u64, cache: tauri::State<'_, SimulationCacheState>) -> Result<(), String> {
    cache
        .jobs
        .lock()
        .map_err(|_| "simulation cache lock poisoned".to_string())?
        .remove(&job_id);
    Ok(())
}

#[tauri::command]
async fn export_simulated_stl(request: SimulationRequest) -> Result<String, String> {
    spawn_blocking(move || export_stl(&request))
        .await
        .map_err(|error| format!("stl export task failed: {error}"))?
}

pub fn run() {
    tauri::Builder::default()
        .manage(SimulationCacheState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_health,
            parse_gcode_overview,
            simulate_gcode,
            simulate_gcode_cached,
            get_simulation_job_status,
            get_simulation_tile,
            release_simulation_job,
            export_simulated_stl
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CNC Simulator");
}
