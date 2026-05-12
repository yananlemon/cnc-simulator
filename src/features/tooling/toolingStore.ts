import { create } from "zustand";
import type { StockConfig, ToolConfig } from "../simulation/simulator";
import type { MachineConfig } from "../simulation/motionPlanner";

interface ToolingState {
  stock: StockConfig;
  tool: ToolConfig;
  machineConfig: MachineConfig;
}

interface ToolingActions {
  setStock: (stock: StockConfig) => void;
  setTool: (tool: ToolConfig) => void;
  setMachineConfig: (config: MachineConfig) => void;
}

export type ToolingStore = ToolingState & ToolingActions;

export const useToolingStore = create<ToolingStore>((set) => ({
  stock: {
    widthMm: 60,
    heightMm: 70,
    thicknessMm: 10,
    resolutionMm: 0.1,
    originXMm: 0,
    originYMm: 0,
  },
  tool: {
    toolType: "ball_nose",
    diameterMm: 3.175,
    angleDeg: 30,
    tipDiameterMm: 0.1,
  },
  machineConfig: {
    max_v_x: 2000,
    max_v_y: 2000,
    max_v_z: 200,
    max_a_x: 20,
    max_a_y: 20,
    max_a_z: 20,
    junction_deviation: 0.01,
  },
  setStock: (stock) => set({ stock }),
  setTool: (tool) => set({ tool }),
  setMachineConfig: (machineConfig) => set({ machineConfig }),
}));
