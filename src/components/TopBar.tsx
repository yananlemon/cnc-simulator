interface TopBarProps {
  fileName: string;
  isSimulating: boolean;
  simulationCompleted: boolean;
  onImportClick: () => void;
  onRunSimulation: () => void;
  onExportStl: () => void;
  isLoading?: boolean;
}

export function TopBar({
  fileName,
  isSimulating,
  simulationCompleted,
  onImportClick,
  onRunSimulation,
  onExportStl,
  isLoading = false
}: TopBarProps) {
  const displayName = fileName === "未导入文件" ? "未导入文件" : fileName;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-section">
          <div className="logo-placeholder">⚙️</div>
          <div>
            <p className="eyebrow">CNC Simulator</p>
            <h1>G-code 浮雕仿真器</h1>
          </div>
        </div>
        <div className="file-info">
          <span className="file-name" title={displayName}>
            {displayName}
          </span>
          <span className={`status-indicator ${isSimulating ? "running" : simulationCompleted ? "completed" : "idle"}`}>
            {isSimulating ? "● 仿真中" : simulationCompleted ? "✓ 已完成" : "○ 就绪"}
          </span>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="ghost-button" type="button" onClick={onImportClick} disabled={isLoading || isSimulating}>
          📁 导入 G-code
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={onRunSimulation}
          disabled={isLoading || isSimulating || fileName === "未导入文件"}
        >
          {isLoading && <span className="loading-spinner"></span>}
          {isLoading ? "解析中..." : isSimulating ? "仿真中..." : "▶ 运行仿真"}
        </button>
        <button
          className="success-button"
          type="button"
          onClick={onExportStl}
          disabled={isSimulating || !simulationCompleted}
          title={!simulationCompleted ? "请先运行仿真" : "导出 STL 模型"}
        >
          💾 导出 STL
        </button>
      </div>
    </header>
  );
}
