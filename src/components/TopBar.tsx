interface TopBarProps {
  onImportClick: () => void;
  onRunSimulation: () => void;
}

export function TopBar({ onImportClick, onRunSimulation }: TopBarProps) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">CNC Simulator</p>
        <h1>G-code 浮雕仿真器</h1>
      </div>
      <div className="topbar-actions">
        <button className="ghost-button" type="button" onClick={onImportClick}>
          导入 G-code
        </button>
        <button className="primary-button" type="button" onClick={onRunSimulation}>
          运行仿真
        </button>
      </div>
    </header>
  );
}
