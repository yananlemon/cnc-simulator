import type {
  ParseOverview,
  SimulationResult,
  StockConfig,
  ToolConfig
} from "../features/simulation/simulator";

interface BottomPanelProps {
  status: string;
  isSimulating: boolean;
  progress: number;
  simulation: SimulationResult | null;
  speedMultiplier: number;
  onSpeedChange: (speed: number) => void;
  playbackState: string;
  computeProgress: number;
  queueLength: number;
  bufferedMs: number;
  logs: string[];
  phase: string;
  elapsedMs: number;
  overview: ParseOverview;
  stock: StockConfig;
  tool: ToolConfig;
  onParse: () => void;
  onSimulate: () => void;
  onExportStl: () => void;
}

const SPEED_STEPS = [1, 2, 4, 8, 12, 16, 24, 32];

export function BottomPanel({
  status,
  isSimulating,
  progress,
  simulation,
  speedMultiplier,
  onSpeedChange,
  playbackState,
  computeProgress,
  queueLength,
  bufferedMs,
  logs,
  phase,
  elapsedMs,
  overview,
  stock,
  tool,
  onParse,
  onSimulate,
  onExportStl
}: BottomPanelProps) {
  const speedIndex = Math.max(0, SPEED_STEPS.findIndex((value) => value === speedMultiplier));

  return (
    <section className="bottom-panel">
      {/* 进度和控制区域 */}
      <div className="bottom-panel-main">
        <div className="progress-section">
          <div className="status-line">{status}</div>
          <div className="timeline-track">
            <div className="timeline-fill" style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
          <div className="timeline-percent">{progress}%</div>
        </div>

        <div className="control-section">
          <div className="control-buttons">
            <button className="ghost-button" type="button" onClick={onParse} disabled={isSimulating}>
              解析
            </button>
            <button className="ghost-button" type="button" onClick={onSimulate} disabled={isSimulating}>
              {isSimulating ? "仿真中..." : "仿真"}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={onExportStl}
              disabled={isSimulating || !simulation}
            >
              导出 STL
            </button>
          </div>

          <div className="metrics-row">
            <label
              className="speed-control"
              style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12px" }}
            >
              <span>播放速度</span>
              <input
                type="range"
                min="0"
                max={String(SPEED_STEPS.length - 1)}
                step="1"
                value={speedIndex}
                onChange={(e) => onSpeedChange(SPEED_STEPS[Number(e.target.value)] ?? 1)}
                style={{ width: "160px" }}
              />
              <span>{speedMultiplier}x</span>
            </label>

            <div className="metrics-badges">
              <span className="metric-badge">{playbackState}</span>
              <span className="metric-badge">计算：{computeProgress}%</span>
              <span className="metric-badge">缓冲：{queueLength}帧/{bufferedMs.toFixed(0)}ms</span>
              {simulation && (
                <>
                  <span className="metric-badge">{simulation.overview.segmentCount}段轨迹</span>
                  <span className="metric-badge">{simulation.estimatedCutPixels}网格点</span>
                  <span className="metric-badge">去除体积 {simulation.removedVolumeMm3.toFixed(1)} mm³</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 可折叠的控制台详情 */}
      <details className="console-details">
        <summary>运行控制台</summary>
        <div className="console-content">
          <div className="console-grid">
            <div className="console-section">
              <h3>运行状态</h3>
              <ul className="console-kv">
                <li>阶段：{phase}</li>
                <li>耗时：{formatElapsed(elapsedMs)}</li>
                <li>播放状态：{playbackState}</li>
                <li>缓冲：{queueLength} 帧 / {bufferedMs.toFixed(0)} ms</li>
              </ul>
            </div>
            <div className="console-section">
              <h3>刀路统计</h3>
              <ul className="console-kv">
                <li>轨迹：{overview.segmentCount} 段</li>
                <li>切削：{overview.cuttingSegmentCount} 段</li>
                <li>圆弧离散：{overview.arcSegmentCount} 段</li>
              </ul>
            </div>
            <div className="console-section">
              <h3>毛坯参数</h3>
              <ul className="console-kv">
                <li>
                  尺寸：{stock.widthMm} x {stock.heightMm} x {stock.thicknessMm} mm
                </li>
                <li>精度：{stock.resolutionMm} mm</li>
                <li>原点：({stock.originXMm}, {stock.originYMm})</li>
              </ul>
            </div>
            <div className="console-section">
              <h3>刀具参数</h3>
              <ul className="console-kv">
                <li>类型：{formatToolType(tool.toolType)}</li>
                <li>直径：{tool.diameterMm} mm</li>
                <li>V 角：{tool.angleDeg} deg</li>
                <li>刀尖直径：{tool.tipDiameterMm} mm</li>
              </ul>
            </div>
            <div className="console-section">
              <h3>结果摘要</h3>
              <ul className="console-kv">
                <li>网格：{simulation ? `${simulation.gridWidth} x ${simulation.gridHeight}` : "-"}</li>
                <li>去除体积：{simulation ? `${simulation.removedVolumeMm3.toFixed(1)} mm³` : "-"}</li>
                <li>高度范围：{simulation ? `${simulation.minSurfaceZMm.toFixed(2)} 到 ${simulation.maxSurfaceZMm.toFixed(2)} mm` : "-"}</li>
              </ul>
            </div>
          </div>

          <div className="console-log">
            <h3>运行日志</h3>
            {logs.length === 0 ? (
              <div className="console-line">暂无日志</div>
            ) : (
              logs.map((log, index) => (
                <div className="console-line" key={`${index}-${log}`}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </details>
    </section>
  );
}

function formatToolType(toolType: ToolConfig["toolType"]): string {
  if (toolType === "ball_nose") return "球头刀";
  if (toolType === "flat_end_mill") return "平底刀";
  return "V 刀";
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor((elapsedMs % 1000) / 10)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds}`;
}
