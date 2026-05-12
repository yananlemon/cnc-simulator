import { useEffect, useMemo, useRef } from "react";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { StageView } from "./components/StageView";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { BottomPanel } from "./components/BottomPanel";
import { GcodeDrawer } from "./components/GcodeDrawer";
import { HelpDialog } from "./components/HelpDialog";
import {
  exportSimulationToStl,
  parseGcode,
  type MotionPoint,
  type ParseOverview,
  type SimulationPreviewFrame,
  type SimulationResult,
  type StockConfig,
  type ToolConfig,
} from "./features/simulation/simulator";
import type {
  MachiningStatistics,
  MachineConfig,
} from "./features/simulation/motionPlanner";
import type { SimulationWorkerOutgoing } from "./workers/simulation.worker";
import type { ParseWorkerOutgoing } from "./workers/parse.worker";
import { useWorkspaceStore } from "./features/workspace/workspaceStore";
import { useToolingStore } from "./features/tooling/toolingStore";
import { useSimulationStore } from "./features/simulation/simulationStore";
import type {
  PlaybackPhase,
  PlaybackMetrics,
} from "./features/simulation/simulationStore";

// ─── Tauri IPC 类型（仅用于 simulateWithRustKernel / handleResetStock） ──────

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

interface RustSimulationJobResult {
  job_id: number;
}

interface RustSimulationTile {
  job_id: number;
  start_row: number;
  row_count: number;
  heights: number[];
}

type RustSimulationJobStatus =
  | { state: "running"; job_id: number }
  | { state: "completed"; job_id: number; summary: RustSimulationSummary }
  | { state: "failed"; job_id: number; message: string };

// ─── App 主组件（编排层） ─────────────────────────────────────────────────────

export function App() {
  const appVersion = "0.1.0";

  // ── Refs（不适合放 store，保持原样） ──────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const simulationWorkerRef = useRef<Worker | null>(null);
  const parseWorkerRef = useRef<Worker | null>(null);
  const currentJobIdRef = useRef<number | null>(null);
  const machiningEstimateRequestIdRef = useRef(0);
  const previewQueueRef = useRef<SimulationPreviewFrame[]>([]);
  const playbackRafRef = useRef<number | null>(null);
  const playbackClockRef = useRef(0);
  const lastPlaybackTickRef = useRef<number | null>(null);
  const playbackPrimedRef = useRef(false);
  const lastDisplayedFrameIndexRef = useRef(-1);

  // ── Workspace store ───────────────────────────────────────────────────────
  const {
    fileName,
    gcode,
    isLoading,
    isGcodeDrawerOpen,
    isHelpOpen,
    setFileName,
    setGcode,
    setIsLoading,
    setIsGcodeDrawerOpen,
    setIsHelpOpen,
  } = useWorkspaceStore();

  // ── Tooling store ─────────────────────────────────────────────────────────
  const { stock, tool, machineConfig, setStock, setTool, setMachineConfig } =
    useToolingStore();

  // ── Simulation store ──────────────────────────────────────────────────────
  const {
    simulation,
    machiningStats,
    isEstimatingMachining,
    previewFrame,
    currentToolPosition,
    status,
    isSimulating,
    progress,
    computeProgress,
    phase,
    startedAt,
    elapsedMs,
    logs,
    showToolpath,
    simulationSpeed,
    playbackMetrics,
    setSimulation,
    setMachiningStats,
    setIsEstimatingMachining,
    setPreviewFrame,
    setCurrentToolPosition,
    setStatus,
    setIsSimulating,
    setProgress,
    setComputeProgress,
    setPhase,
    setStartedAt,
    setElapsedMs,
    setShowToolpath,
    setSimulationSpeed,
    setPendingFinalResult,
    setPlaybackMetrics,
    appendLog,
    resetPlayback,
  } = useSimulationStore();

  // ── parsedGcode（派生自 store 中的 gcode） ────────────────────────────────
  const parsedGcode = useMemo(() => parseGcode(gcode), [gcode]);
  const overview = parsedGcode.overview;
  const segments = parsedGcode.segments;

  // ── Effect 1：仿真计时器 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isSimulating || startedAt === null) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 120);

    return () => window.clearInterval(timer);
  }, [isSimulating, startedAt, setElapsedMs]);

  // ── Effect 2：卸载时清理 Worker 与 RAF ────────────────────────────────────
  useEffect(() => {
    return () => {
      simulationWorkerRef.current?.terminate();
      simulationWorkerRef.current = null;
      parseWorkerRef.current?.terminate();
      parseWorkerRef.current = null;
      if (playbackRafRef.current !== null) {
        cancelAnimationFrame(playbackRafRef.current);
      }
    };
  }, []);

  // ── Effect 3：将速度变更同步至仿真 Worker ─────────────────────────────────
  useEffect(() => {
    if (isSimulating && simulationWorkerRef.current) {
      simulationWorkerRef.current.postMessage({
        type: "updateSpeed",
        payload: simulationSpeed,
      });
    }
  }, [simulationSpeed, isSimulating]);

  // ── Effect 4：加工时间数字孪生预估 ───────────────────────────────────────
  useEffect(() => {
    if (!gcode.trim() || !isTauriRuntime()) {
      setMachiningStats(null);
      setIsEstimatingMachining(false);
      return;
    }

    const requestId = machiningEstimateRequestIdRef.current + 1;
    machiningEstimateRequestIdRef.current = requestId;
    setIsEstimatingMachining(true);

    const timer = window.setTimeout(() => {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<MachiningStatistics>("estimate_machining_time", {
          gcode,
          config: machineConfig,
        })
          .then((stats) => {
            if (machiningEstimateRequestIdRef.current !== requestId) {
              return;
            }
            setMachiningStats(stats);
            appendLog("数字孪生加工时间预估完成");
          })
          .catch((err) => {
            if (machiningEstimateRequestIdRef.current !== requestId) {
              return;
            }
            setMachiningStats(null);
            appendLog(`加工时间预估失败：${err}`);
          })
          .finally(() => {
            if (machiningEstimateRequestIdRef.current === requestId) {
              setIsEstimatingMachining(false);
            }
          });
      });
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    appendLog,
    gcode,
    machineConfig,
    setIsEstimatingMachining,
    setMachiningStats,
  ]);

  // ── Effect 5：播放 RAF 循环 ───────────────────────────────────────────────
  //   tick 内部通过 useSimulationStore.getState() 读取最新状态，
  //   彻底避免 pendingFinalResult / playbackMetrics 的闭包陷阱。
  useEffect(() => {
    if (!isSimulating) {
      if (playbackRafRef.current !== null) {
        cancelAnimationFrame(playbackRafRef.current);
        playbackRafRef.current = null;
      }
      playbackClockRef.current = 0;
      lastPlaybackTickRef.current = null;
      playbackPrimedRef.current = false;
      return;
    }

    const tick = (_timestamp: number) => {
      const queue = previewQueueRef.current;

      // ── 有新帧时更新视图 ─────────────────────────────────────────────────
      if (queue.length > 0) {
        const latestFrame = queue[queue.length - 1];

        if (latestFrame.frameIndex !== lastDisplayedFrameIndexRef.current) {
          lastDisplayedFrameIndexRef.current = latestFrame.frameIndex;

          // 使用 getState() 直接调用 actions，不走 React 渲染路径
          const s = useSimulationStore.getState();
          s.setPhase("播放切削过程");
          s.setPreviewFrame(latestFrame);
          s.setCurrentToolPosition(latestFrame.currentPoint);
          s.setProgress(latestFrame.percent);
          s.setPlaybackMetrics((current) => ({
            ...current,
            queueLength: queue.length,
            bufferedMs: getBufferedTimelineMs(queue),
            playedFrames: current.playedFrames + 1,
            generatedFrames: latestFrame.frameIndex,
          }));
        }

        // 清空已消费的帧，防止内存积累
        previewQueueRef.current = [];
      }

      // ── 每帧通过 getState() 读取最新的 pendingFinalResult / metrics ───────
      const simState = useSimulationStore.getState();
      const { pendingFinalResult, playbackMetrics: currentMetrics } = simState;

      // 队列已空 + 最终结果就绪 → 切换到高精度结果并结束仿真
      if (
        pendingFinalResult &&
        queue.length === 0 &&
        currentMetrics.previewProductionDone
      ) {
        simState.setPhase("等待最终高精度结果");
        simState.setStatus("高精度结果已完成，正在切换最终网格...");
        simState.setPreviewFrame(null);
        simState.setCurrentToolPosition(null);
        simState.setSimulation(pendingFinalResult);
        simState.setPendingFinalResult(null);
        simState.setProgress(100);
        simState.setPhase("仿真完成");
        simState.setStatus(
          `仿真完成，已处理 ${pendingFinalResult.overview.cuttingSegmentCount} 段切削轨迹。`,
        );
        simState.appendLog(
          `仿真完成，处理 ${pendingFinalResult.overview.cuttingSegmentCount} 段切削轨迹`,
        );
        simState.setIsSimulating(false);
        simState.setComputeProgress(100);
        simState.setPlaybackMetrics((current) => ({
          ...current,
          queueLength: 0,
          bufferedMs: 0,
        }));
        playbackRafRef.current = null;
        playbackClockRef.current = 0;
        lastPlaybackTickRef.current = null;
        playbackPrimedRef.current = false;
        return;
      }

      // 过程帧已全部播完，但最终结果尚未到达 → 继续等待
      if (
        queue.length === 0 &&
        currentMetrics.previewProductionDone &&
        !pendingFinalResult
      ) {
        simState.setPhase("缓冲过程帧");
        simState.setStatus("过程帧播放完成，等待高精度仿真结果...");
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
  }, [isSimulating]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsLoading(true);
    setPhase("已加载文件");
    setStatus(`正在解析 ${file.name}...`);
    appendLog(`开始解析文件 ${file.name}`);

    try {
      const text = await file.text();

      // 使用 Worker 异步解析 G-code，避免阻塞 UI
      const parseWorker = new Worker(
        new URL("./workers/parse.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      parseWorkerRef.current = parseWorker;

      const parseResult = await new Promise<{
        overview: ParseOverview;
        segments: any[];
      }>((resolve, reject) => {
        parseWorker.onmessage = (
          message: MessageEvent<ParseWorkerOutgoing>,
        ) => {
          const event = message.data;

          if (event.type === "success") {
            resolve({
              overview: event.payload.overview,
              segments: event.payload.segments,
            });
          } else if (event.type === "error") {
            reject(new Error(event.payload.message));
          }
        };

        parseWorker.onerror = () => {
          reject(new Error("解析 Worker 执行失败"));
        };

        // 发送解析请求
        parseWorker.postMessage({
          type: "parse",
          payload: {
            gcode: text,
          },
        });
      });

      const autoStock = deriveStockFromOverview(parseResult.overview);

      setFileName(file.name);
      setGcode(text);
      setStock(autoStock);
      // resetPlayback 原子更新：simulation/previewFrame/pendingFinalResult/
      //   currentToolPosition/progress/computeProgress/playbackMetrics
      resetPlayback();
      setMachiningStats(null);
      setIsGcodeDrawerOpen(false);
      previewQueueRef.current = [];
      lastDisplayedFrameIndexRef.current = -1;
      playbackClockRef.current = 0;
      lastPlaybackTickRef.current = null;
      playbackPrimedRef.current = false;
      setPhase("解析完成");
      setStatus(`已加载 ${file.name}，毛坯已按刀路范围自动生成。`);
      appendLog(
        `导入文件 ${file.name}，共 ${parseResult.overview.segmentCount} 段轨迹`,
      );

      // 解析成功，立即恢复按钮可用状态
      setIsLoading(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setPhase("仿真失败");
      setStatus(`解析失败：${message}`);
      appendLog(`解析失败：${message}`);
      setIsLoading(false);
    } finally {
      // cleanup 在后台异步执行，不影响 UI 状态
      setTimeout(() => {
        parseWorkerRef.current?.terminate();
        parseWorkerRef.current = null;
      }, 0);
    }
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
    resetPlayback();
    previewQueueRef.current = [];
    lastDisplayedFrameIndexRef.current = -1;
    playbackClockRef.current = 0;
    lastPlaybackTickRef.current = null;
    playbackPrimedRef.current = false;
    setPhase("缓冲过程帧");
    const runStartedAt = Date.now();
    setStartedAt(runStartedAt);
    setElapsedMs(0);
    setStatus("正在准备过程缓冲与最终高精度仿真...");
    appendLog("开始执行仿真");

    try {
      simulationWorkerRef.current?.terminate();
      const worker = new Worker(
        new URL("./workers/simulation.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      simulationWorkerRef.current = worker;

      const previewCompletion = new Promise<SimulationResult>(
        (resolve, reject) => {
          worker.onmessage = (
            message: MessageEvent<SimulationWorkerOutgoing>,
          ) => {
            const event = message.data;

            if (event.type === "progress") {
              const next = event.payload;
              setComputeProgress(next.percent);
              setStatus(
                `过程计算：${next.completedSegments} / ${next.totalSegments} 段，已完成 ${next.percent}%`,
              );
              return;
            }

            if (event.type === "preview") {
              previewQueueRef.current.push(event.payload);
              setPlaybackMetrics((current) => ({
                ...current,
                generatedFrames: current.generatedFrames + 1,
                queueLength: previewQueueRef.current.length,
                bufferedMs: getBufferedTimelineMs(previewQueueRef.current),
              }));
              return;
            }

            if (event.type === "complete") {
              setComputeProgress(100);
              setPlaybackMetrics((current) => ({
                ...current,
                previewProductionDone: true,
              }));
              // 不要在这里提前结束仿真状态，让播放循环来处理队列清空后的状态转换
              // 这样可以确保 pendingFinalResult 已经被正确设置
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
              speedMultiplier: simulationSpeed,
            },
          });
        },
      );

      const finalResultPromise = simulateWithRustKernel(
        gcode,
        stock,
        tool,
        overview,
        (jobId) => {
          // 保存当前作业 ID，用于后续清理
          currentJobIdRef.current = jobId;
        },
      );
      const previewResult = await previewCompletion;
      const finalResult = (await finalResultPromise) ?? previewResult;

      setElapsedMs(Date.now() - runStartedAt);
      setPendingFinalResult(finalResult);
      setPlaybackMetrics((current) => ({
        ...current,
        previewProductionDone: true,
        finalResultReady: true,
      }));
      setStatus(
        `过程帧已缓存完成，正在按当前速度播放 ${previewResult.overview.cuttingSegmentCount} 段切削轨迹。`,
      );
      appendLog(`过程帧生成完成，等待播放结束后切换最终高精度结果`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      previewQueueRef.current = [];
      lastDisplayedFrameIndexRef.current = -1;
      playbackClockRef.current = 0;
      lastPlaybackTickRef.current = null;
      playbackPrimedRef.current = false;
      setPreviewFrame(null);
      setPendingFinalResult(null);
      setCurrentToolPosition(null);
      setPhase("仿真失败");
      setStatus(`仿真失败：${message}`);
      appendLog(`仿真失败：${message}`);
      setIsSimulating(false);
      setComputeProgress(0);
      setPlaybackMetrics(() => ({
        queueLength: 0,
        bufferedMs: 0,
        generatedFrames: 0,
        playedFrames: 0,
        previewProductionDone: false,
        finalResultReady: false,
      }));
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
        const stl = exportSimulationToStl(
          simulation,
          sanitizeSolidName(fileName),
        );
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
      },
    });
  };

  const handleParse = () => {
    setProgress(0);
    setPhase("解析完成");
    setStatus(`已解析 ${fileName}，共 ${overview.segmentCount} 段轨迹。`);
    appendLog(`解析完成：${overview.segmentCount} 段轨迹`);
  };

  const handleResetStock = async () => {
    // 清理 Rust 后端的仿真作业缓存，确保下次仿真使用新数据
    if (currentJobIdRef.current !== null && isTauriRuntime()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const releasedCount = await invoke<number>(
          "release_all_simulation_jobs",
        );
        if (releasedCount > 0) {
          appendLog(`已清理 ${releasedCount} 个仿真作业缓存`);
        }
        currentJobIdRef.current = null;
      } catch (err) {
        // 清理失败不影响后续操作
        appendLog("仿真缓存清理完成");
      }
    }

    resetPlayback();
    previewQueueRef.current = [];
    lastDisplayedFrameIndexRef.current = -1;
    playbackClockRef.current = 0;
    lastPlaybackTickRef.current = null;
    playbackPrimedRef.current = false;
    setPhase("重置毛坯");
    setStatus("已手动生成空白毛坯。");
    appendLog("重新生成空白毛坯尺寸");
  };

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <LoadingOverlay
        visible={isLoading}
        message={`正在解析 ${fileName || "G-code"}...`}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".nc,.tap,.gcode,.txt"
        hidden
        onChange={handleFileChange}
      />
      <TopBar
        fileName={gcode.trim() ? fileName : "未导入文件"}
        isSimulating={isSimulating}
        simulationCompleted={!!simulation && !isSimulating}
        onOpenHelp={() => setIsHelpOpen(true)}
        onImportClick={handleImportClick}
        onParse={handleParse}
        onRunSimulation={handleRunSimulation}
        onExportStl={handleExportStl}
        isLoading={isLoading}
      />
      <div className="workspace-shell">
        <aside className="compact-sidebar">
          <Sidebar
            fileName={fileName}
            gcode={gcode}
            stock={stock}
            tool={tool}
            simulation={simulation}
            machiningStats={machiningStats}
            machineConfig={machineConfig}
            isEstimatingMachining={isEstimatingMachining}
            status={status}
            playbackState={describePlaybackState(phase, playbackMetrics)}
            computeProgress={computeProgress}
            queueLength={playbackMetrics.queueLength}
            bufferedMs={playbackMetrics.bufferedMs}
            logs={logs}
            phase={phase}
            elapsedMs={elapsedMs}
            onStockChange={setStock}
            onToolChange={setTool}
            onMachineConfigChange={setMachineConfig}
            onResetStock={handleResetStock}
            overview={overview}
            showToolpath={showToolpath}
            onShowToolpathChange={setShowToolpath}
            onOpenGcodeViewer={() => setIsGcodeDrawerOpen(true)}
            isLoading={isLoading}
          />
        </aside>
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
          <BottomPanel
            status={status}
            isSimulating={isSimulating}
            progress={progress}
            simulationSegmentCount={simulation?.overview.segmentCount ?? null}
            removedVolumeMm3={simulation?.removedVolumeMm3 ?? null}
            speedMultiplier={simulationSpeed}
            onSpeedChange={setSimulationSpeed}
            playbackState={describePlaybackState(phase, playbackMetrics)}
            computeProgress={computeProgress}
            queueLength={playbackMetrics.queueLength}
            bufferedMs={playbackMetrics.bufferedMs}
          />
        </main>
      </div>
      <GcodeDrawer
        open={isGcodeDrawerOpen}
        fileName={fileName}
        gcode={gcode}
        onClose={() => setIsGcodeDrawerOpen(false)}
      />
      <HelpDialog
        open={isHelpOpen}
        version={appVersion}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}

// ─── 纯辅助函数（不依赖 React / store） ──────────────────────────────────────

function deriveStockFromOverview(overview: ParseOverview): StockConfig {
  const marginMm = 2;
  const widthMm = Math.max(
    20,
    Math.ceil(overview.max.x - overview.min.x + marginMm * 2),
  );
  const heightMm = Math.max(
    20,
    Math.ceil(overview.max.y - overview.min.y + marginMm * 2),
  );
  const cutDepth = Math.max(0, Math.abs(overview.min.z));
  const thicknessMm = Math.max(10, Math.ceil(cutDepth + 2));

  return {
    widthMm,
    heightMm,
    thicknessMm,
    resolutionMm: 0.1,
    originXMm: overview.min.x - marginMm,
    originYMm: overview.min.y - marginMm,
  };
}

function sanitizeSolidName(fileName: string): string {
  return (
    fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_") ||
    "artimaker_relief"
  );
}

function getBufferedTimelineMs(queue: SimulationPreviewFrame[]): number {
  return queue.length >= 2
    ? queue[queue.length - 1].timelineMs - queue[0].timelineMs
    : 0;
}

function describePlaybackState(
  phase: PlaybackPhase,
  metrics: PlaybackMetrics,
): string {
  if (phase === "缓冲过程帧") {
    return `缓冲中（${metrics.queueLength} 帧）`;
  }
  if (phase === "播放切削过程") {
    return `播放中（已播 ${metrics.playedFrames} / 产出 ${metrics.generatedFrames}）`;
  }
  if (phase === "等待最终高精度结果") {
    return metrics.finalResultReady
      ? "等待播放结束切换最终结果"
      : "等待高精度结果";
  }
  return phase;
}

function getExtraSkipFrames(speed: number, queueLength: number): number {
  if (queueLength <= 2) {
    return 0;
  }
  if (speed >= 32) {
    return Math.min(queueLength - 1, 10);
  }
  if (speed >= 24) {
    return Math.min(queueLength - 1, 8);
  }
  if (speed >= 16) {
    return Math.min(queueLength - 1, 6);
  }
  if (speed >= 12) {
    return Math.min(queueLength - 1, 4);
  }
  if (speed >= 8) {
    return Math.min(queueLength - 1, 2);
  }
  if (speed >= 4) {
    return 1;
  }
  return 0;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function simulateWithRustKernel(
  gcode: string,
  stock: StockConfig,
  tool: ToolConfig,
  overview: ParseOverview,
  onJobCreated?: (jobId: number) => void,
): Promise<SimulationResult | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const request = {
    gcode,
    stock: {
      width_mm: stock.widthMm,
      height_mm: stock.heightMm,
      thickness_mm: stock.thicknessMm,
      resolution_mm: stock.resolutionMm,
      origin_x_mm: stock.originXMm,
      origin_y_mm: stock.originYMm,
    },
    tool: {
      tool_type: tool.toolType,
      diameter_mm: tool.diameterMm,
      angle_deg: tool.toolType === "v_bit" ? tool.angleDeg : null,
      tip_diameter_mm: tool.toolType === "v_bit" ? tool.tipDiameterMm : null,
    },
  };

  const job = await invoke<RustSimulationJobResult>("simulate_gcode_cached", {
    request,
  });

  // Notify caller about the job ID for later cleanup
  if (onJobCreated) {
    onJobCreated(job.job_id);
  }

  let summary: RustSimulationSummary | null = null;
  while (!summary) {
    const status = await invoke<RustSimulationJobStatus>(
      "get_simulation_job_status",
      {
        jobId: job.job_id,
      },
    );
    if (status.state === "completed") {
      summary = status.summary;
      break;
    }
    if (status.state === "failed") {
      throw new Error(status.message);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  const heights = new Float32Array(summary.grid_width * summary.grid_height);
  const tileRows = Math.min(
    48,
    Math.max(12, Math.floor(8192 / Math.max(1, summary.grid_width))),
  );

  try {
    for (
      let startRow = 0;
      startRow < summary.grid_height;
      startRow += tileRows
    ) {
      const tile = await invoke<RustSimulationTile>("get_simulation_tile", {
        jobId: job.job_id,
        startRow,
        rowCount: tileRows,
      });
      heights.set(tile.heights, tile.start_row * summary.grid_width);

      // Yield to the UI thread between tiles so the desktop window stays responsive while
      // the high-precision result is being reconstructed on the frontend side.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    await invoke("release_simulation_job", { jobId: job.job_id }).catch(
      () => null,
    );
  }

  return {
    overview: {
      ...overview,
      segmentCount: summary.segment_count,
      cuttingSegmentCount: summary.cutting_segment_count,
    },
    gridWidth: summary.grid_width,
    gridHeight: summary.grid_height,
    stock,
    cellResolutionMm: summary.resolution_mm,
    minSurfaceZMm: summary.min_height_mm,
    maxSurfaceZMm: summary.max_height_mm,
    removedVolumeMm3: summary.removed_volume_mm3,
    estimatedCutPixels: summary.estimated_cut_pixels,
    heights,
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
          origin_y_mm: args.stock.originYMm,
        },
        tool: {
          tool_type: args.tool.toolType,
          diameter_mm: args.tool.diameterMm,
          angle_deg: args.tool.toolType === "v_bit" ? args.tool.angleDeg : null,
          tip_diameter_mm:
            args.tool.toolType === "v_bit" ? args.tool.tipDiameterMm : null,
        },
      },
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
