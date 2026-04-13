import { useMemo, useState } from "react";
import type {
  ParseOverview,
  SimulationResult,
  StockConfig,
  ToolConfig,
  ToolType
} from "../features/simulation/simulator";

interface SidebarProps {
  fileName: string;
  gcode: string;
  stock: StockConfig;
  tool: ToolConfig;
  overview: ParseOverview;
  simulation: SimulationResult | null;
  status: string;
  playbackState: string;
  computeProgress: number;
  queueLength: number;
  bufferedMs: number;
  logs: string[];
  phase: string;
  elapsedMs: number;
  onStockChange: (value: StockConfig) => void;
  onToolChange: (value: ToolConfig) => void;
  onResetStock: () => void;
  showToolpath: boolean;
  onShowToolpathChange: (value: boolean) => void;
  onOpenGcodeViewer: () => void;
  isLoading?: boolean;
}

type SidebarPanel = "file" | "stock" | "tool" | "analysis" | "runtime";

export function Sidebar({
  fileName,
  gcode,
  stock,
  tool,
  overview,
  simulation,
  status,
  playbackState,
  computeProgress,
  queueLength,
  bufferedMs,
  logs,
  phase,
  elapsedMs,
  onStockChange,
  onToolChange,
  onResetStock,
  showToolpath,
  onShowToolpathChange,
  onOpenGcodeViewer,
  isLoading = false
}: SidebarProps) {
  const [activePanel, setActivePanel] = useState<SidebarPanel>("file");
  const displayName = fileName.includes("鏈鍏") ? "未导入文件" : fileName;
  const gcodeLineCount = useMemo(() => gcode.split(/\r?\n/).length, [gcode]);
  const fileExtension = displayName.includes(".") ? displayName.split(".").pop()?.toUpperCase() : "NC";

  const updateStock = (key: keyof StockConfig, value: string) => {
    onStockChange({
      ...stock,
      [key]: Number(value)
    });
  };

  const updateToolNumber = (key: keyof ToolConfig, value: string) => {
    onToolChange({
      ...tool,
      [key]: Number(value)
    });
  };

  const updateToolType = (value: string) => {
    onToolChange({
      ...tool,
      toolType: value as ToolType
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-layout">
        <nav className="sidebar-nav" aria-label="工具面板">
          <button
            type="button"
            className={`sidebar-nav-button ${activePanel === "file" ? "active" : ""}`}
            onClick={() => setActivePanel("file")}
          >
            <span className="sidebar-nav-label">文件</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-button ${activePanel === "stock" ? "active" : ""}`}
            onClick={() => setActivePanel("stock")}
          >
            <span className="sidebar-nav-label">毛坯</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-button ${activePanel === "tool" ? "active" : ""}`}
            onClick={() => setActivePanel("tool")}
          >
            <span className="sidebar-nav-label">刀具</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-button ${activePanel === "analysis" ? "active" : ""}`}
            onClick={() => setActivePanel("analysis")}
          >
            <span className="sidebar-nav-label">分析</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-button ${activePanel === "runtime" ? "active" : ""}`}
            onClick={() => setActivePanel("runtime")}
          >
            <span className="sidebar-nav-label">运行</span>
          </button>
        </nav>

        <section className="panel-card sidebar-panel">
          {activePanel === "file" ? (
            <>
              <div className="sidebar-panel-header">
                <div>
                  <h2>文件</h2>
                  <p className="card-hint">{isLoading ? "正在解析..." : displayName}</p>
                </div>
              </div>

              <div className="sidebar-stat-grid">
                <div className="sidebar-stat">
                  <span className="sidebar-stat-label">轨迹段数</span>
                  <strong>{overview.segmentCount.toLocaleString()}</strong>
                </div>
                <div className="sidebar-stat">
                  <span className="sidebar-stat-label">切削段数</span>
                  <strong>{overview.cuttingSegmentCount.toLocaleString()}</strong>
                </div>
              </div>

              <div className="sidebar-stat-grid">
                <div className="sidebar-stat">
                  <span className="sidebar-stat-label">G-code 行数</span>
                  <strong>{gcodeLineCount.toLocaleString()}</strong>
                </div>
                <div className="sidebar-stat">
                  <span className="sidebar-stat-label">文件类型</span>
                  <strong>{fileExtension}</strong>
                </div>
              </div>

              <label className="sidebar-inline-toggle">
                <input
                  type="checkbox"
                  checked={showToolpath}
                  onChange={(event) => onShowToolpathChange(event.target.checked)}
                />
                <span>显示 G-code 轨迹线</span>
              </label>

              <div className="sidebar-actions-row">
                <button type="button" className="ghost-button sidebar-inline-button" onClick={onOpenGcodeViewer}>
                  查看 G-code
                </button>
              </div>
            </>
          ) : null}

          {activePanel === "stock" ? (
            <>
              <div className="sidebar-panel-header">
                <div>
                  <h2>毛坯参数</h2>
                  <p className="card-hint">集中调整尺寸、厚度和仿真精度。</p>
                </div>
              </div>

              <div className="field-grid compact-field-grid">
                <label className="field-label">
                  宽度 (mm)
                  <input
                    type="number"
                    value={stock.widthMm}
                    onChange={(event) => updateStock("widthMm", event.target.value)}
                  />
                </label>
                <label className="field-label">
                  高度 (mm)
                  <input
                    type="number"
                    value={stock.heightMm}
                    onChange={(event) => updateStock("heightMm", event.target.value)}
                  />
                </label>
                <label className="field-label">
                  厚度 (mm)
                  <input
                    type="number"
                    value={stock.thicknessMm}
                    onChange={(event) => updateStock("thicknessMm", event.target.value)}
                  />
                </label>
                <label className="field-label">
                  仿真精度 (mm)
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={stock.resolutionMm}
                    onChange={(event) => updateStock("resolutionMm", event.target.value)}
                  />
                </label>
              </div>

              <div className="sidebar-stat-grid">
                <div className="sidebar-stat">
                  <span className="sidebar-stat-label">原点 X</span>
                  <strong>{stock.originXMm.toFixed(2)} mm</strong>
                </div>
                <div className="sidebar-stat">
                  <span className="sidebar-stat-label">原点 Y</span>
                  <strong>{stock.originYMm.toFixed(2)} mm</strong>
                </div>
              </div>

              <button type="button" className="ghost-button wide-button" onClick={onResetStock}>
                创建 / 重置毛坯
              </button>
            </>
          ) : null}

          {activePanel === "tool" ? (
            <>
              <div className="sidebar-panel-header">
                <div>
                  <h2>刀具参数</h2>
                  <p className="card-hint">切换刀具类型，并微调几何参数。</p>
                </div>
              </div>

              <div className="field-grid compact-field-grid">
                <label className="field-label">
                  刀具类型
                  <select value={tool.toolType} onChange={(event) => updateToolType(event.target.value)}>
                    <option value="ball_nose">球头刀</option>
                    <option value="flat_end_mill">平底刀</option>
                    <option value="v_bit">V 刀</option>
                  </select>
                </label>
                <label className="field-label">
                  直径 (mm)
                  <input
                    type="number"
                    step="0.001"
                    value={tool.diameterMm}
                    onChange={(event) => updateToolNumber("diameterMm", event.target.value)}
                  />
                </label>
                <label className="field-label">
                  V 角度 (deg)
                  <input
                    type="number"
                    value={tool.angleDeg}
                    onChange={(event) => updateToolNumber("angleDeg", event.target.value)}
                  />
                </label>
                <label className="field-label">
                  刀尖直径 (mm)
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tool.tipDiameterMm}
                    onChange={(event) => updateToolNumber("tipDiameterMm", event.target.value)}
                  />
                </label>
              </div>
            </>
          ) : null}

          {activePanel === "analysis" ? (
            <>
              <div className="sidebar-panel-header">
                <div>
                  <h2>分析信息</h2>
                  <p className="card-hint">显示解析后的范围与轨迹统计。</p>
                </div>
              </div>

              <div className="analysis-list">
                <div className="analysis-item">
                  <span>轨迹总段数</span>
                  <strong>{overview.segmentCount.toLocaleString()}</strong>
                </div>
                <div className="analysis-item">
                  <span>切削段数</span>
                  <strong>{overview.cuttingSegmentCount.toLocaleString()}</strong>
                </div>
                <div className="analysis-item">
                  <span>圆弧离散段数</span>
                  <strong>{overview.arcSegmentCount.toLocaleString()}</strong>
                </div>
                <div className="analysis-item">
                  <span>X 范围</span>
                  <strong>
                    {overview.min.x.toFixed(2)} 到 {overview.max.x.toFixed(2)} mm
                  </strong>
                </div>
                <div className="analysis-item">
                  <span>Y 范围</span>
                  <strong>
                    {overview.min.y.toFixed(2)} 到 {overview.max.y.toFixed(2)} mm
                  </strong>
                </div>
                <div className="analysis-item">
                  <span>Z 范围</span>
                  <strong>
                    {overview.min.z.toFixed(2)} 到 {overview.max.z.toFixed(2)} mm
                  </strong>
                </div>
              </div>
            </>
          ) : null}

          {activePanel === "runtime" ? (
            <>
              <div className="sidebar-panel-header">
                <div>
                  <h2>运行详情</h2>
                  <p className="card-hint">把运行状态、结果摘要和日志集中在左侧查看。</p>
                </div>
              </div>

              <div className="analysis-list">
                <div className="analysis-item">
                  <span>当前状态</span>
                  <strong>{status}</strong>
                </div>
                <div className="analysis-item">
                  <span>阶段</span>
                  <strong>{phase}</strong>
                </div>
                <div className="analysis-item">
                  <span>耗时</span>
                  <strong>{formatElapsed(elapsedMs)}</strong>
                </div>
                <div className="analysis-item">
                  <span>播放状态</span>
                  <strong>{playbackState}</strong>
                </div>
                <div className="analysis-item">
                  <span>计算进度</span>
                  <strong>{computeProgress}%</strong>
                </div>
                <div className="analysis-item">
                  <span>缓冲</span>
                  <strong>{queueLength} 帧 / {bufferedMs.toFixed(0)} ms</strong>
                </div>
                <div className="analysis-item">
                  <span>结果网格</span>
                  <strong>{simulation ? `${simulation.gridWidth} x ${simulation.gridHeight}` : "-"}</strong>
                </div>
                <div className="analysis-item">
                  <span>去除体积</span>
                  <strong>{simulation ? `${simulation.removedVolumeMm3.toFixed(1)} mm鲁` : "-"}</strong>
                </div>
                <div className="analysis-item">
                  <span>高度范围</span>
                  <strong>
                    {simulation ? `${simulation.minSurfaceZMm.toFixed(2)} 到 ${simulation.maxSurfaceZMm.toFixed(2)} mm` : "-"}
                  </strong>
                </div>
              </div>

              <div className="sidebar-log-panel">
                <div className="sidebar-log-header">运行日志</div>
                <div className="sidebar-log">
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
            </>
          ) : null}
        </section>
      </div>
    </aside>
  );
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
