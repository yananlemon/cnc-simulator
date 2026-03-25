import type {
  ParseOverview,
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
  onGcodeChange: (value: string) => void;
  onStockChange: (value: StockConfig) => void;
  onToolChange: (value: ToolConfig) => void;
  onResetStock: () => void;
  showToolpath: boolean;
  onShowToolpathChange: (value: boolean) => void;
}

export function Sidebar({
  fileName,
  gcode,
  stock,
  tool,
  overview,
  onGcodeChange,
  onStockChange,
  onToolChange,
  onResetStock,
  showToolpath,
  onShowToolpathChange
}: SidebarProps) {
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
      <section className="panel-card">
        <h2>G-code 工作区</h2>
        <p className="card-hint">{fileName}</p>
        <label className="field-label">
          G-code 内容
          <textarea
            className="code-editor"
            value={gcode}
            onChange={(event) => onGcodeChange(event.target.value)}
          />
        </label>

        <label className="field-label" style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "8px", flexDirection: "row", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showToolpath}
            onChange={(e) => onShowToolpathChange(e.target.checked)}
            style={{ width: "16px", height: "16px", margin: 0 }}
          />
          <span style={{ fontSize: "14px", fontWeight: "normal", opacity: 0.9 }}>显示 G-code 轨迹线</span>
        </label>
      </section>

      <section className="panel-card">
        <h2>毛坯参数</h2>
        <div className="field-grid">
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
        <button
          type="button"
          className="ghost-button"
          style={{ marginTop: "12px", width: "100%" }}
          onClick={onResetStock}
        >
          创建/重置毛坯
        </button>
      </section>

      <section className="panel-card">
        <h2>刀具参数</h2>
        <div className="field-grid">
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
        </div>
      </section>

      <details className="panel-card details-card">
        <summary>更多信息</summary>
        <ul className="info-list">
          <li>轨迹总段数: {overview.segmentCount}</li>
          <li>切削段数: {overview.cuttingSegmentCount}</li>
          <li>圆弧离散段数: {overview.arcSegmentCount}</li>
          <li>
            X 范围: {overview.min.x.toFixed(2)} 到 {overview.max.x.toFixed(2)} mm
          </li>
          <li>
            Y 范围: {overview.min.y.toFixed(2)} 到 {overview.max.y.toFixed(2)} mm
          </li>
          <li>
            Z 范围: {overview.min.z.toFixed(2)} 到 {overview.max.z.toFixed(2)} mm
          </li>
        </ul>
      </details>
    </aside>
  );
}
