import type { SimulationResult } from "../features/simulation/simulator";

interface TimelinePanelProps {
  onParse: () => void;
  onSimulate: () => void | Promise<void>;
  onExportStl: () => void;
  simulation: SimulationResult | null;
  status: string;
  isSimulating: boolean;
  progress: number;
  speedMultiplier: number;
  onSpeedChange: (speed: number) => void;
}

const SPEED_STEPS = [1, 2, 4, 8, 12, 16, 24, 32];

export function TimelinePanel({
  onParse,
  onSimulate,
  onExportStl,
  simulation,
  status,
  isSimulating,
  progress,
  speedMultiplier,
  onSpeedChange
}: TimelinePanelProps) {
  const speedIndex = Math.max(0, SPEED_STEPS.findIndex((value) => value === speedMultiplier));

  return (
    <section className="timeline-panel">
      <div className="timeline-summary">
        <div>
          <p className="status-line">{status}</p>
        </div>
        <div className="timeline-buttons">
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
      </div>
      <div className="timeline-track">
        <div className="timeline-fill" style={{ width: `${Math.max(4, progress)}%` }} />
      </div>
      <div className="timeline-percent">{progress}%</div>
      <div className="timeline-metrics">
        <label
          className="field-label"
          style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12px" }}
        >
          <span>仿真速度</span>
          <input
            type="range"
            min="0"
            max={String(SPEED_STEPS.length - 1)}
            step="1"
            value={speedIndex}
            onChange={(e) => onSpeedChange(SPEED_STEPS[Number(e.target.value)] ?? 1)}
            style={{ width: "140px" }}
          />
          <span>{speedMultiplier}x</span>
        </label>
        {simulation ? (
          <>
            <span>{simulation.overview.segmentCount} 段轨迹</span>
            <span>{simulation.estimatedCutPixels} 个网格点参与切削</span>
            <span>去除体积 {simulation.removedVolumeMm3.toFixed(1)} mm³</span>
          </>
        ) : null}
      </div>
    </section>
  );
}
