import { useEffect, useState } from "react";

interface HelpDialogProps {
  open: boolean;
  version: string;
  onClose: () => void;
}

type HelpTab = "quickstart" | "about";

export function HelpDialog({ open, version, onClose }: HelpDialogProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>("quickstart");

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const buildInfo = `CNC Simulator ${version}\nTauri Desktop\nReact + Three.js + Rust`;

  return (
    <div className="help-dialog-layer" role="dialog" aria-modal="true" aria-label="帮助与关于">
      <button type="button" className="help-dialog-backdrop" onClick={onClose} aria-label="关闭帮助面板" />

      <section className="help-dialog">
        <header className="help-dialog-header">
          <div>
            <p className="help-dialog-eyebrow">Help Center</p>
            <h2 className="help-dialog-title">帮助与关于</h2>
            <p className="help-dialog-subtitle">快速查看操作流程、支持范围和当前版本信息。</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="help-dialog-tabs">
          <button
            type="button"
            className={`help-tab-button ${activeTab === "quickstart" ? "active" : ""}`}
            onClick={() => setActiveTab("quickstart")}
          >
            快速开始
          </button>
          <button
            type="button"
            className={`help-tab-button ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            关于软件
          </button>
        </div>

        <div className="help-dialog-content">
          {activeTab === "quickstart" ? (
            <div className="help-sections">
              <section className="help-section">
                <h3>基本流程</h3>
                <ol className="help-list ordered">
                  <li>点击顶部“导入 G-code”，载入 `.nc`、`.tap`、`.gcode` 或 `.txt` 文件。</li>
                  <li>在左侧“毛坯”和“刀具”面板里确认尺寸与刀具参数。</li>
                  <li>需要核对源文件时，点击“查看 G-code”打开右侧代码抽屉。</li>
                  <li>点击“运行仿真”，观察 3D 结果、轨迹线和底部状态条进度。</li>
                  <li>结果确认后，点击“导出 STL”输出模型。</li>
                </ol>
              </section>

              <section className="help-section">
                <h3>支持范围</h3>
                <ul className="help-list">
                  <li>桌面壳：Tauri</li>
                  <li>3D 视图：Three.js</li>
                  <li>支持刀具：球头刀、平底刀、V 刀</li>
                  <li>输出结果：仿真结果 STL</li>
                  <li>辅助信息入口：文件、分析、运行、G-code 抽屉</li>
                </ul>
              </section>

              <section className="help-section">
                <h3>使用建议</h3>
                <ul className="help-list">
                  <li>主视图优先看仿真结果，参数和日志都在侧边区域查看。</li>
                  <li>窗口空间较紧时，优先关闭 G-code 抽屉，保留更大的 3D 视图。</li>
                  <li>如果需要排查进度或错误，进入左侧“运行”标签查看状态与日志。</li>
                </ul>
              </section>
            </div>
          ) : null}

          {activeTab === "about" ? (
            <div className="help-sections">
              <section className="help-section">
                <h3>产品信息</h3>
                <ul className="help-list">
                  <li>名称：CNC Simulator</li>
                  <li>版本：{version}</li>
                  <li>定位：G-code 雕刻仿真桌面工具</li>
                  <li>目标：导入、仿真、预览并导出 STL</li>
                </ul>
              </section>

              <section className="help-section">
                <h3>技术栈</h3>
                <ul className="help-list">
                  <li>桌面：Tauri 2</li>
                  <li>前端：React + TypeScript + Vite</li>
                  <li>渲染：Three.js</li>
                  <li>仿真内核：Rust</li>
                </ul>
              </section>

              <section className="help-section">
                <h3>构建信息</h3>
                <div className="help-build-card">
                  <div className="help-build-row">
                    <span>App Version</span>
                    <strong>{version}</strong>
                  </div>
                  <div className="help-build-row">
                    <span>Mode</span>
                    <strong>Desktop</strong>
                  </div>
                  <div className="help-build-row">
                    <span>Workflow</span>
                    <strong>Offline-first</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => navigator.clipboard.writeText(buildInfo).catch(() => null)}
                >
                  复制版本信息
                </button>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
