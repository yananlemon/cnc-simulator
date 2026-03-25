import {
  simulateGcodeWithProgress,
  type MotionPoint,
  type SimulationPreviewFrame,
  type SimulationProgress,
  type SimulationResult,
  type StockConfig,
  type ToolConfig
} from "../features/simulation/simulator";

interface SimulationStartMessage {
  type: "start";
  payload: {
    gcode: string;
    stock: StockConfig;
    tool: ToolConfig;
    speedMultiplier?: number;
  };
}

interface SimulationSpeedMessage {
  type: "updateSpeed";
  payload: number;
}

interface SimulationProgressMessage {
  type: "progress";
  payload: SimulationProgress;
}

interface SimulationPreviewMessage {
  type: "preview";
  payload: SimulationPreviewFrame;
}

interface SimulationCompleteMessage {
  type: "complete";
  payload: SimulationResult;
}

interface SimulationErrorMessage {
  type: "error";
  payload: {
    message: string;
    currentPoint: MotionPoint | null;
  };
}

type SimulationWorkerIncoming = SimulationStartMessage | SimulationSpeedMessage;
export type SimulationWorkerOutgoing =
  | SimulationProgressMessage
  | SimulationPreviewMessage
  | SimulationCompleteMessage
  | SimulationErrorMessage;

let currentSpeed = 1.0;

self.onmessage = async (event: MessageEvent<SimulationWorkerIncoming>) => {
  if (event.data.type === "updateSpeed") {
    currentSpeed = event.data.payload;
    return;
  }

  if (event.data.type !== "start") {
    return;
  }

  const { gcode, stock, tool, speedMultiplier } = event.data.payload;
  currentSpeed = speedMultiplier ?? 1.0;

  try {
    const result = await simulateGcodeWithProgress(
      gcode,
      stock,
      tool,
      () => currentSpeed,
      (progress) => {
        const message: SimulationProgressMessage = {
          type: "progress",
          payload: progress
        };
        self.postMessage(message);
      },
      (preview) => {
        const message: SimulationPreviewMessage = {
          type: "preview",
          payload: preview
        };
        self.postMessage(message);
      }
    );

    const message: SimulationCompleteMessage = {
      type: "complete",
      payload: result
    };
    self.postMessage(message);
  } catch (error) {
    const message: SimulationErrorMessage = {
      type: "error",
      payload: {
        message: error instanceof Error ? error.message : "未知错误",
        currentPoint: null
      }
    };
    self.postMessage(message);
  }
};
