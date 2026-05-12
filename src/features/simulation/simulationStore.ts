import { create } from "zustand";
import type { MachiningStatistics } from "./motionPlanner";
import type {
  MotionPoint,
  SimulationPreviewFrame,
  SimulationResult,
} from "./simulator";

export type PlaybackPhase =
  | "待机"
  | "已加载文件"
  | "解析完成"
  | "重置毛坯"
  | "已导出 STL"
  | "缓冲过程帧"
  | "播放切削过程"
  | "等待最终高精度结果"
  | "仿真完成"
  | "仿真失败";

export interface PlaybackMetrics {
  queueLength: number;
  bufferedMs: number;
  generatedFrames: number;
  playedFrames: number;
  previewProductionDone: boolean;
  finalResultReady: boolean;
}

const INITIAL_METRICS: PlaybackMetrics = {
  queueLength: 0,
  bufferedMs: 0,
  generatedFrames: 0,
  playedFrames: 0,
  previewProductionDone: false,
  finalResultReady: false,
};

interface SimulationState {
  simulation: SimulationResult | null;
  machiningStats: MachiningStatistics | null;
  isEstimatingMachining: boolean;
  previewFrame: SimulationPreviewFrame | null;
  currentToolPosition: MotionPoint | null;
  isSimulating: boolean;
  progress: number;
  computeProgress: number;
  phase: PlaybackPhase;
  startedAt: number | null;
  elapsedMs: number;
  logs: string[];
  showToolpath: boolean;
  simulationSpeed: number;
  pendingFinalResult: SimulationResult | null;
  playbackMetrics: PlaybackMetrics;
  status: string;
}

interface SimulationActions {
  setSimulation: (v: SimulationResult | null) => void;
  setMachiningStats: (v: MachiningStatistics | null) => void;
  setIsEstimatingMachining: (v: boolean) => void;
  setPreviewFrame: (v: SimulationPreviewFrame | null) => void;
  setCurrentToolPosition: (v: MotionPoint | null) => void;
  setIsSimulating: (v: boolean) => void;
  setProgress: (v: number) => void;
  setComputeProgress: (v: number) => void;
  setPhase: (v: PlaybackPhase) => void;
  setStartedAt: (v: number | null) => void;
  setElapsedMs: (v: number) => void;
  setShowToolpath: (v: boolean) => void;
  setSimulationSpeed: (v: number) => void;
  setPendingFinalResult: (v: SimulationResult | null) => void;
  setPlaybackMetrics: (updater: (prev: PlaybackMetrics) => PlaybackMetrics) => void;
  setStatus: (v: string) => void;
  appendLog: (message: string) => void;
  resetPlayback: () => void;
}

export type SimulationStore = SimulationState & SimulationActions;

export const useSimulationStore = create<SimulationStore>((set) => ({
  simulation: null,
  machiningStats: null,
  isEstimatingMachining: false,
  previewFrame: null,
  currentToolPosition: null,
  isSimulating: false,
  progress: 100,
  computeProgress: 0,
  phase: "待机",
  startedAt: null,
  elapsedMs: 0,
  logs: ["系统启动完成", "等待导入 G-code 文件"],
  showToolpath: false,
  simulationSpeed: 1,
  pendingFinalResult: null,
  playbackMetrics: INITIAL_METRICS,
  status: "请先导入 G-code 文件。",

  setSimulation: (simulation) => set({ simulation }),
  setMachiningStats: (machiningStats) => set({ machiningStats }),
  setIsEstimatingMachining: (isEstimatingMachining) => set({ isEstimatingMachining }),
  setPreviewFrame: (previewFrame) => set({ previewFrame }),
  setCurrentToolPosition: (currentToolPosition) => set({ currentToolPosition }),
  setIsSimulating: (isSimulating) => set({ isSimulating }),
  setProgress: (progress) => set({ progress }),
  setComputeProgress: (computeProgress) => set({ computeProgress }),
  setPhase: (phase) => set({ phase }),
  setStartedAt: (startedAt) => set({ startedAt }),
  setElapsedMs: (elapsedMs) => set({ elapsedMs }),
  setShowToolpath: (showToolpath) => set({ showToolpath }),
  setSimulationSpeed: (simulationSpeed) => set({ simulationSpeed }),
  setPendingFinalResult: (pendingFinalResult) => set({ pendingFinalResult }),
  setPlaybackMetrics: (updater) =>
    set((state) => ({ playbackMetrics: updater(state.playbackMetrics) })),
  setStatus: (status) => set({ status }),
  appendLog: (message) => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    set((state) => ({
      logs: [`[${timestamp}] ${message}`, ...state.logs].slice(0, 12),
    }));
  },
  resetPlayback: () =>
    set({
      simulation: null,
      previewFrame: null,
      pendingFinalResult: null,
      currentToolPosition: null,
      progress: 0,
      computeProgress: 0,
      playbackMetrics: INITIAL_METRICS,
    }),
}));
