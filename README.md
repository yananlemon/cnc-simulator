# CNC Simulator

CNC Simulator is a brand-new standalone desktop application focused on G-code driven carving simulation.

## Goals

- Import and inspect G-code files
- Simulate the carved result directly from G-code
- Support 2D engraving, 2.5D carving, and 3D relief workflows
- Preview stock, tool, and toolpath in 3D
- Export simulated stock as STL

## Tech Stack

- Desktop shell: Tauri 2
- Frontend: React + TypeScript + Vite
- Rendering: Three.js with WebGL2
- Native simulation engine: Rust

## Project Layout

- `src/`: React application
- `src-tauri/`: Rust desktop shell and native commands
- `docs/`: Architecture and implementation notes

## Status

This repository is intentionally new and independent. It does not depend on legacy project code.

## Next Milestones

1. Add file import and project workspace state
2. Finalize Rust G-code parser coverage
3. Display simulated height field as a live mesh
4. Add STL export workflow
5. Add playback and analysis tools
