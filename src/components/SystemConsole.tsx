import type {
  ParseOverview,
  SimulationResult,
  StockConfig,
  ToolConfig
} from "../features/simulation/simulator";

interface SystemConsoleProps {
  fileName: string;
  status: string;
  isSimulating: boolean;
  progress: number;
  logs: string[];
  phase: string;
  elapsedMs: number;
  overview: ParseOverview;
  stock: StockConfig;
  tool: ToolConfig;
  simulation: SimulationResult | null;
}

export function SystemConsole({
  fileName,
  status,
  isSimulating,
  progress,
  logs,
  phase,
  elapsedMs,
  overview,
  stock,
  tool,
  simulation
}: SystemConsoleProps) {
  return (
    <details className="panel-card console-panel details-card">
      <summary>运行控制台</summary>
      <h2>系统控制台</h2>
      <div className="console-badges">
        <span className={`console-badge ${isSimulating ? "running" : "idle"}`}>
          {isSimulating ? "仿真中" : "空闲"}
        </span>
        <span className="console-badge neutral">阶段: {phase}</span>
        <span className="console-badge neutral">进度: {progress}%</span>
      </div>
      <p className="console-status">{status}</p>
      <div className="console-grid">
        <div className="console-section">
          <h3>运行状态</h3>
          <ul className="console-kv">
            <li>文件：{fileName}</li>
            <li>耗时：{formatElapsed(elapsedMs)}</li>
            <li>轨迹：{overview.segmentCount} 段</li>
            <li>切削：{overview.cuttingSegmentCount} 段</li>
          </ul>
        </div>
        <div className="console-section">
          <h3>毛坯参数</h3>
          <ul className="console-kv">
            <li>
              尺寸：{stock.widthMm} x {stock.heightMm} x {stock.thicknessMm} mm
            </li>
            <li>精度：{stock.resolutionMm} mm</li>
          </ul>
        </div>
        <div className="console-section">
          <h3>刀具参数</h3>
          <ul className="console-kv">
            <li>类型：{formatToolType(tool.toolType)}</li>
            <li>直径：{tool.diameterMm} mm</li>
            <li>V 角：{tool.angleDeg} deg</li>
          </ul>
        </div>
        <div className="console-section">
          <h3>结果摘要</h3>
          <ul className="console-kv">
            <li>圆弧离散：{overview.arcSegmentCount} 段</li>
            <li>网格：{simulation ? `${simulation.gridWidth} x ${simulation.gridHeight}` : "-"}</li>
            <li>
              去除体积：
              {simulation ? `${simulation.removedVolumeMm3.toFixed(1)} mm³` : "-"}
            </li>
          </ul>
        </div>
      </div>
      <div className="console-log">
        {logs.length === 0 ? <div className="console-line">暂无日志</div> : null}
        {logs.map((log, index) => (
          <div className="console-line" key={`${index}-${log}`}>
            {log}
          </div>
        ))}
      </div>
    </details>
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
