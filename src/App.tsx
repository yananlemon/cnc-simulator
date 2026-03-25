import { useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { StageView } from "./components/StageView";
import { TimelinePanel } from "./components/TimelinePanel";
import { SystemConsole } from "./components/SystemConsole";
import {
  exportSimulationToStl,
  parseGcode,
  type MotionPoint,
  type ParseOverview,
  type SimulationPreviewFrame,
  type SimulationResult,
  type StockConfig,
  type ToolConfig
} from "./features/simulation/simulator";
import type { SimulationWorkerOutgoing } from "./workers/simulation.worker";

interface RustSimulationSummary {
  width_mm: number;
  height_mm: number;
  thickness_mm: number;
  resolution_mm: number;
  grid_width: number;
  grid_height: number;
  removed_volume_mm3: number;
  min_height_mm: number;
  max_height_mm: number;
  segment_count: number;
  cutting_segment_count: number;
  estimated_cut_pixels: number;
}

interface RustSimulationResult {
  summary: RustSimulationSummary;
  heights: number[];
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const simulationWorkerRef = useRef<Worker | null>(null);
  const previewQueueRef = useRef<SimulationPreviewFrame[]>([]);
  const playbackRafRef = useRef<number | null>(null);
  const playbackBudgetRef = useRef(0);
  const playbackPrimedRef = useRef(false);

  const [fileName, setFileName] = useState("未导入文件");
  const [gcode, setGcode] = useState("");
  const [stock, setStock] = useState<StockConfig>({
    widthMm: 60,
    heightMm: 70,
    thicknessMm: 10,
    resolutionMm: 0.1,
    originXMm: 0,
    originYMm: 0
  });
  const [tool, setTool] = useState<ToolConfig>({
    toolType: "ball_nose",
    diameterMm: 3.175,
    angleDeg: 30
  });
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [previewFrame, setPreviewFrame] = useState<SimulationPreviewFrame | null>(null);
  const [currentToolPosition, setCurrentToolPosition] = useState<MotionPoint | null>(null);
  const [status, setStatus] = useState("请先导入 G-code 文件。");
  const [isSimulating, setIsSimulating] = useState(false);
  const [progress, setProgress] = useState(100);
  const [phase, setPhase] = useState("待机");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [logs, setLogs] = useState<string[]>(["系统启动完成", "等待导入 G-code 文件"]);
  const [showToolpath, setShowToolpath] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [pendingFinalResult, setPendingFinalResult] = useState<SimulationResult | null>(null);

  const parsedGcode = useMemo(() => parseGcode(gcode), [gcode]);
  const overview = parsedGcode.overview;
  const segments = parsedGcode.segments;

  useEffect(() => {
    if (!isSimulating || startedAt === null) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 120);

    return () => window.clearInterval(timer);
  }, [isSimulating, startedAt]);

  useEffect(() => {
    return () => {
      simulationWorkerRef.current?.terminate();
      simulationWorkerRef.current = null;
      if (playbackRafRef.current !== null) {
        cancelAnimationFrame(playbackRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSimulating) {
      if (playbackRafRef.current !== null) {
        cancelAnimationFrame(playbackRafRef.current);
        playbackRafRef.current = null;
      }
      playbackBudgetRef.current = 0;
      playbackPrimedRef.current = false;
      return;
    }

    const tick = () => {
      const queue = previewQueueRef.current;
      if (!playbackPrimedRef.current) {
        const bufferedMs =
          queue.length >= 2 ? queue[queue.length - 1].generatedAtMs - queue[0].generatedAtMs : 0;
        if (bufferedMs < 450 && !pendingFinalResult) {
          playbackRafRef.current = requestAnimationFrame(tick);
          return;
        }
        playbackPrimedRef.current = true;
      }

      playbackBudgetRef.current += Math.max(0.5, simulationSpeed * 0.35);
      const framesToConsume = Math.max(1, Math.floor(playbackBudgetRef.current));

      if (queue.length > 0) {
        let latestFrame: SimulationPreviewFrame | null = null;
        const consumeCount = Math.min(queue.length, framesToConsume);
        for (let index = 0; index < consumeCount; index += 1) {
          latestFrame = queue.shift() ?? latestFrame;
        }
        playbackBudgetRef.current = Math.max(0, playbackBudgetRef.current - consumeCount);
        if (latestFrame) {
          setPreviewFrame(latestFrame);
          setCurrentToolPosition(latestFrame.currentPoint);
          setProgress(latestFrame.percent);
        }
      } else if (pendingFinalResult) {
        setSimulation(pendingFinalResult);
        setPendingFinalResult(null);
        setPreviewFrame(null);
        setCurrentToolPosition(null);
        setProgress(100);
        setPhase("仿真完成");
        setStatus(`仿真完成，已处理 ${pendingFinalResult.overview.cuttingSegmentCount} 段切削轨迹。`);
        appendLog(`仿真完成，处理 ${pendingFinalResult.overview.cuttingSegmentCount} 段切削轨迹`);
        setIsSimulating(false);
        playbackRafRef.current = null;
        playbackBudgetRef.current = 0;
        playbackPrimedRef.current = false;
        return;
      }

      playbackRafRef.current = requestAnimationFrame(tick);
    };

    playbackRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackRafRef.current !== null) {
        cancelAnimationFrame(playbackRafRef.current);
        playbackRafRef.current = null;
      }
    };
  }, [isSimulating, simulationSpeed, pendingFinalResult]);

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    setLogs((current) => [`[${timestamp}] ${message}`, ...current].slice(0, 12));
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    const parsed = parseGcode(text);
    const autoStock = deriveStockFromOverview(parsed.overview);

    setFileName(file.name);
    setGcode(text);
    setStock(autoStock);
    setSimulation(null);
    setPreviewFrame(null);
    setPendingFinalResult(null);
    setCurrentToolPosition(null);
    previewQueueRef.current = [];
    playbackBudgetRef.current = 0;
    playbackPrimedRef.current = false;
    setProgress(0);
    setPhase("已加载文件");
    setStatus(`已加载 ${file.name}，毛坯已按刀路范围自动生成。`);
    appendLog(`导入文件 ${file.name}`);
  };

  const handleRunSimulation = async () => {
    if (isSimulating) {
      return;
    }

    if (!gcode.trim()) {
      setStatus("当前没有 G-code 内容，请先导入文件。");
      appendLog("仿真取消：没有可用的 G-code");
      return;
    }

    setIsSimulating(true);
    setSimulation(null);
    setPreviewFrame(null);
    setPendingFinalResult(null);
    setCurrentToolPosition(null);
    previewQueueRef.current = [];
    playbackBudgetRef.current = 0;
    setPhase("准备仿真");
    setProgress(0);
    const runStartedAt = Date.now();
    setStartedAt(runStartedAt);
    setElapsedMs(0);
    setStatus("正在准备仿真...");
    appendLog("开始执行仿真");

    try {
      simulationWorkerRef.current?.terminate();
      const worker = new Worker(new URL("./workers/simulation.worker.ts", import.meta.url), {
        type: "module"
      });
      simulationWorkerRef.current = worker;

      const result = await new Promise<SimulationResult>((resolve, reject) => {
        worker.onmessage = (message: MessageEvent<SimulationWorkerOutgoing>) => {
          const event = message.data;

          if (event.type === "progress") {
            const next = event.payload;
            setPhase(next.stage);
            setProgress(next.percent);
            setCurrentToolPosition(next.currentPoint);
            setStatus(`${next.stage}：${next.completedSegments} / ${next.totalSegments} 段，完成 ${next.percent}%`);
            return;


          }

          if (event.type === "preview") {
            previewQueueRef.current.push(event.payload);
            return;
          }

          if (event.type === "complete") {
            resolve(event.payload);
            return;
          }

          reject(new Error(event.payload.message));
        };

        worker.onerror = () => {
          reject(new Error("仿真 Worker 执行失败"));
        };

        worker.postMessage({
          type: "start",
          payload: {
            gcode,
            stock,
            tool,
            speedMultiplier: 1
          }
        });
      });

      setElapsedMs(Date.now() - runStartedAt);
      setPendingFinalResult(result);
      setPhase("播放切削过程");
      setStatus(`计算已完成，正在按当前速度播放 ${result.overview.cuttingSegmentCount} 段切削轨迹。`);
      appendLog(`计算完成，开始播放 ${result.overview.cuttingSegmentCount} 段切削轨迹`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      previewQueueRef.current = [];
      playbackBudgetRef.current = 0;
      playbackPrimedRef.current = false;
      setPreviewFrame(null);
      setPendingFinalResult(null);
      setCurrentToolPosition(null);
      setPhase("仿真失败");
      setStatus(`仿真失败：${message}`);
      appendLog(`仿真失败：${message}`);
      setIsSimulating(false);
    } finally {
      simulationWorkerRef.current?.terminate();
      simulationWorkerRef.current = null;
    }
  };

  const handleExportStl = () => {
    if (!simulation) {
      setStatus("请先运行仿真，再导出 STL。");
      appendLog("导出失败：当前没有仿真结果");
      return;
    }

    void exportStlWithBestAvailablePath({
      gcode,
      stock,
      tool,
      simulation,
      fileName,
      onSuccess: (message) => {
        setStatus(message);
        setPhase("已导出 STL");
        appendLog(message);
      },
      onFallback: () => {
        const stl = exportSimulationToStl(simulation, sanitizeSolidName(fileName));
        const blob = new Blob([stl], { type: "model/stl" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${fileName.replace(/\.[^.]+$/, "") || "simulated-relief"}.stl`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        const message = `已导出 ${fileName} 的 STL 文件。`;
        setStatus(message);
        setPhase("已导出 STL");
        appendLog(`${message}（前端回退路径）`);
      }
    });
  };

  const handleParse = () => {
    setProgress(0);
    setPhase("解析完成");
    setStatus(`已解析 ${fileName}，共 ${overview.segmentCount} 段轨迹。`);
    appendLog(`解析完成：${overview.segmentCount} 段轨迹`);
  };

  const handleResetStock = () => {
    setSimulation(null);
    setPreviewFrame(null);
    setPendingFinalResult(null);
    setCurrentToolPosition(null);
    previewQueueRef.current = [];
    playbackBudgetRef.current = 0;
    playbackPrimedRef.current = false;
    setProgress(0);
    setPhase("重置毛坯");
    setStatus("已手动生成空白毛坯。");
    appendLog("重新生成空白毛坯尺寸");
  };
  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept=".nc,.tap,.gcode,.txt"
        hidden
        onChange={handleFileChange}
      />
      <TopBar onImportClick={handleImportClick} onRunSimulation={handleRunSimulation} />
      <div className="workspace-shell">
        <div className="sidebar-stack">
          <Sidebar
            fileName={fileName}
            gcode={gcode}
            stock={stock}
            tool={tool}
            onGcodeChange={setGcode}
            onStockChange={setStock}
            onToolChange={setTool}
            onResetStock={handleResetStock}
            overview={overview}
            showToolpath={showToolpath}
            onShowToolpathChange={setShowToolpath}
          />
          <SystemConsole
            fileName={fileName}
            status={status}
            isSimulating={isSimulating}
            progress={progress}
            logs={logs}
            phase={phase}
            elapsedMs={elapsedMs}
            overview={overview}
            stock={stock}
            tool={tool}
            simulation={simulation}
          />
        </div>
        <main className="stage-shell">
          <StageView
            fileName={fileName}
            simulation={simulation}
            previewFrame={previewFrame}
            stock={stock}
            tool={tool}
            status={status}
            currentToolPosition={currentToolPosition}
            isSimulating={isSimulating}
            showToolpath={showToolpath}
            toolpathSegments={segments}
          />
          <TimelinePanel
            onParse={handleParse}
            onSimulate={handleRunSimulation}
            onExportStl={handleExportStl}
            simulation={simulation}
            status={status}
            isSimulating={isSimulating}
            progress={progress}
            speedMultiplier={simulationSpeed}
            onSpeedChange={setSimulationSpeed}
          />
        </main>
      </div>
    </div>
  );
}

function deriveStockFromOverview(overview: ParseOverview): StockConfig {
  const marginMm = 2;
  const widthMm = Math.max(20, Math.ceil(overview.max.x - overview.min.x + marginMm * 2));
  const heightMm = Math.max(20, Math.ceil(overview.max.y - overview.min.y + marginMm * 2));
  const cutDepth = Math.max(0, Math.abs(overview.min.z));
  const thicknessMm = Math.max(10, Math.ceil(cutDepth + 2));

  return {
    widthMm,
    heightMm,
    thicknessMm,
    resolutionMm: 0.1,
    originXMm: overview.min.x - marginMm,
    originYMm: overview.min.y - marginMm
  };
}

function sanitizeSolidName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_") || "artimaker_relief";
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function simulateWithRustKernel(
  gcode: string,
  stock: StockConfig,
  tool: ToolConfig,
  overview: ParseOverview
): Promise<SimulationResult | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const rustResult = await invoke<RustSimulationResult>("simulate_gcode", {
    request: {
      gcode,
      stock: {
        width_mm: stock.widthMm,
        height_mm: stock.heightMm,
        thickness_mm: stock.thicknessMm,
        resolution_mm: stock.resolutionMm,
        origin_x_mm: stock.originXMm,
        origin_y_mm: stock.originYMm
      },
      tool: {
        tool_type: tool.toolType,
        diameter_mm: tool.diameterMm,
        angle_deg: tool.toolType === "v_bit" ? tool.angleDeg : null
      }
    }
  });

  return {
    overview: {
      ...overview,
      segmentCount: rustResult.summary.segment_count,
      cuttingSegmentCount: rustResult.summary.cutting_segment_count
    },
    gridWidth: rustResult.summary.grid_width,
    gridHeight: rustResult.summary.grid_height,
    stock,
    cellResolutionMm: rustResult.summary.resolution_mm,
    minSurfaceZMm: rustResult.summary.min_height_mm,
    maxSurfaceZMm: rustResult.summary.max_height_mm,
    removedVolumeMm3: rustResult.summary.removed_volume_mm3,
    estimatedCutPixels: rustResult.summary.estimated_cut_pixels,
    heights: Float32Array.from(rustResult.heights)
  };
}

async function exportStlWithBestAvailablePath(args: {
  gcode: string;
  stock: StockConfig;
  tool: ToolConfig;
  simulation: SimulationResult;
  fileName: string;
  onSuccess: (message: string) => void;
  onFallback: () => void;
}) {
  if (!isTauriRuntime()) {
    args.onFallback();
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const stl = await invoke<string>("export_simulated_stl", {
      request: {
        gcode: args.gcode,
        stock: {
          width_mm: args.stock.widthMm,
          height_mm: args.stock.heightMm,
          thickness_mm: args.stock.thicknessMm,
          resolution_mm: args.simulation.cellResolutionMm,
          origin_x_mm: args.stock.originXMm,
          origin_y_mm: args.stock.originYMm
        },
        tool: {
          tool_type: args.tool.toolType,
          diameter_mm: args.tool.diameterMm,
          angle_deg: args.tool.toolType === "v_bit" ? args.tool.angleDeg : null
        }
      }
    });

    const blob = new Blob([stl], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${args.fileName.replace(/\.[^.]+$/, "") || "simulated-relief"}.stl`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    args.onSuccess(`已导出 ${args.fileName} 的 STL 文件。`);
  } catch {
    args.onFallback();
  }
}
