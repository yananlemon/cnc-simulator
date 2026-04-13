interface TopBarProps {
  fileName: string;
  isSimulating: boolean;
  simulationCompleted: boolean;
  onImportClick: () => void;
  onParse: () => void;
  onRunSimulation: () => void;
  onExportStl: () => void;
  onOpenHelp: () => void;
  isLoading?: boolean;
}

export function TopBar({
  fileName,
  isSimulating,
  simulationCompleted,
  onImportClick,
  onParse,
  onRunSimulation,
  onExportStl,
  onOpenHelp,
  isLoading = false
}: TopBarProps) {
  const isEmptyFile = fileName.includes("未导入文件");
  const displayName = isEmptyFile ? "未导入文件" : fileName;
  const statusText = isSimulating ? "运行中" : simulationCompleted ? "已完成" : "就绪";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-section">
          <div className="logo-placeholder">C</div>
          <div>
            <p className="eyebrow">CNC Simulator</p>
            <h1 className="topbar-title">G-code 雕刻仿真</h1>
          </div>
        </div>

        <div className="file-info">
          <span className="file-name" title={displayName}>
            {displayName}
          </span>
          <span className={`status-indicator ${isSimulating ? "running" : simulationCompleted ? "completed" : "idle"}`}>
            {statusText}
          </span>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="ghost-button" type="button" onClick={onOpenHelp}>
          Help
        </button>
        <button className="ghost-button" type="button" onClick={onImportClick} disabled={isLoading || isSimulating}>
          导入 G-code
        </button>
        <button className="ghost-button" type="button" onClick={onParse} disabled={isLoading || isSimulating}>
          解析
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={onRunSimulation}
          disabled={isLoading || isSimulating || isEmptyFile}
        >
          {isLoading && <span className="loading-spinner"></span>}
          {isLoading ? "解析中..." : isSimulating ? "仿真中..." : "运行仿真"}
        </button>
        <button
          className="success-button"
          type="button"
          onClick={onExportStl}
          disabled={isSimulating || !simulationCompleted}
          title={!simulationCompleted ? "请先运行仿真" : "导出 STL 模型"}
        >
          导出 STL
        </button>
      </div>
    </header>
  );
}
