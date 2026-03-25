# Architecture

## Product Direction

CNC Simulator is a fresh desktop product focused on G-code carving simulation rather than machine control.

## Core Domains

1. Workspace management
2. G-code ingestion
3. Tool definition
4. Stock definition
5. Material removal simulation
6. Playback engine
7. Export pipeline

## Recommended Internal Modules

### Frontend

- `features/workspace`: file loading, project metadata, persistence
- `features/tooling`: tool and stock parameter forms
- `features/simulation`: viewport, playback, overlays

### Native

- `io`: local file access, project save/load
- `parser`: G-code parsing and normalization
- `simulation`: stock height field, tool sweep, mesh output
- `export`: STL generation

## Technical Strategy

### Phase 1

- Build simulation-first Rust core
- Add import workflow
- Add normalized project state
- Add summary output for parsed toolpaths

### Phase 2

- Parse G-code into motion segments
- Model stock block and tool parameters
- Run height-field stock removal

### Phase 3

- Show simulated mesh in viewport
- Support ball nose, flat end mill, and V-bit
- Export current stock mesh as STL

### Phase 4

- Improve performance with worker threads and native acceleration
- Add richer analysis and machining statistics

## Design Principles

- Independent repository and naming
- Clear separation between UI and simulation engine
- Deterministic project files
- Offline-first desktop workflow
