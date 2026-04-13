interface BottomPanelProps {
  status: string;
  isSimulating: boolean;
  progress: number;
  simulationSegmentCount: number | null;
  removedVolumeMm3: number | null;
  speedMultiplier: number;
  onSpeedChange: (speed: number) => void;
  playbackState: string;
  computeProgress: number;
  queueLength: number;
  bufferedMs: number;
}

const SPEED_STEPS = [1, 2, 4, 8, 12, 16, 24, 32];

export function BottomPanel({
  status,
  isSimulating,
  progress,
  simulationSegmentCount,
  removedVolumeMm3,
  speedMultiplier,
  onSpeedChange,
  playbackState,
  computeProgress,
  queueLength,
  bufferedMs
}: BottomPanelProps) {
  const speedIndex = Math.max(0, SPEED_STEPS.findIndex((value) => value === speedMultiplier));

  return (
    <section className="bottom-panel">
      <div className="bottom-panel-main">
        <div className="bottom-summary-row">
          <div className="bottom-summary-copy">
            <div className="status-line">{status}</div>
            <div className="metrics-badges">
              <span className={`metric-badge ${isSimulating ? "metric-running" : "metric-idle"}`}>
                {isSimulating ? "仿真中" : simulationSegmentCount ? "仿真完成" : "就绪"}
              </span>
              <span className="metric-badge">{playbackState}</span>
              <span className="metric-badge">计算 {computeProgress}%</span>
              <span className="metric-badge">缓冲 {queueLength} 帧 / {bufferedMs.toFixed(0)}ms</span>
              {simulationSegmentCount ? (
                <span className="metric-badge">{simulationSegmentCount} 段轨迹</span>
              ) : null}
              {removedVolumeMm3 !== null ? (
                <span className="metric-badge">去除体积 {removedVolumeMm3.toFixed(1)} mm鲁</span>
              ) : null}
            </div>
          </div>

          <label className="speed-control compact-speed-control">
            <span>播放速度</span>
            <input
              type="range"
              min="0"
              max={String(SPEED_STEPS.length - 1)}
              step="1"
              value={speedIndex}
              onChange={(event) => onSpeedChange(SPEED_STEPS[Number(event.target.value)] ?? 1)}
            />
            <span>{speedMultiplier}x</span>
          </label>
        </div>

        <div className="progress-section">
          <div className="timeline-track">
            <div className="timeline-fill" style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
          <div className="timeline-footer">
            <span className="timeline-percent">{progress}%</span>
          </div>
        </div>
      </div>
    </section>
  );
}
