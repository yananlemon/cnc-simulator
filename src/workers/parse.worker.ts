// G-code 解析 Worker - 在独立线程中执行，避免阻塞 UI
import { parseGcode } from "../features/simulation/simulator";

interface ParseRequest {
  type: "parse";
  payload: {
    gcode: string;
  };
}

type ParseWorkerIncoming = ParseRequest;

interface ParseSuccessResult {
  type: "success";
  payload: {
    overview: any;
    segments: any[];
  };
}

interface ParseErrorResult {
  type: "error";
  payload: {
    message: string;
  };
}

export type ParseWorkerOutgoing = ParseSuccessResult | ParseErrorResult;

self.onmessage = (event: MessageEvent<ParseWorkerIncoming>) => {
  try {
    const { type, payload } = event.data;

    if (type === "parse") {
      const result = parseGcode(payload.gcode);
      
      const outgoing: ParseSuccessResult = {
        type: "success",
        payload: {
          overview: result.overview,
          segments: result.segments
        }
      };
      
      self.postMessage(outgoing);
    }
  } catch (error) {
    const outgoing: ParseErrorResult = {
      type: "error",
      payload: {
        message: error instanceof Error ? error.message : "解析失败"
      }
    };
    
    self.postMessage(outgoing);
  }
};

export {};
