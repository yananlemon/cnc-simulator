import { useEffect, useMemo, useState } from "react";

interface GcodeDrawerProps {
  open: boolean;
  fileName: string;
  gcode: string;
  onClose: () => void;
}

interface RenderToken {
  text: string;
  className: string;
}

const TOKEN_PATTERN = /(\([^)]*\)|;.*$|\/\/.*$|[GMXYZFIJSTRNP][-+]?\d*\.?\d+)/gi;

export function GcodeDrawer({ open, fileName, gcode, onClose }: GcodeDrawerProps) {
  const [search, setSearch] = useState("");
  const [wrapLines, setWrapLines] = useState(false);
  const lines = useMemo(() => gcode.split(/\r?\n/), [gcode]);
  const visibleLines = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return lines.map((content, index) => ({ content, lineNumber: index + 1 }));
    }

    return lines
      .map((content, index) => ({ content, lineNumber: index + 1 }))
      .filter(({ content }) => content.toLowerCase().includes(keyword));
  }, [lines, search]);

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

  const displayName = fileName.includes("鏈鍏") ? "未导入文件" : fileName;

  return (
    <div className="gcode-drawer-layer" role="dialog" aria-modal="true" aria-label="G-code 查看器">
      <button type="button" className="gcode-drawer-backdrop" aria-label="关闭 G-code 查看器" onClick={onClose} />

      <aside className="gcode-drawer">
        <header className="gcode-drawer-header">
          <div className="gcode-drawer-title-group">
            <p className="gcode-drawer-eyebrow">G-code Viewer</p>
            <h2 className="gcode-drawer-title">{displayName}</h2>
            <span className="gcode-drawer-meta">
              {lines.length.toLocaleString()} 行 · {visibleLines.length.toLocaleString()} 条可见
            </span>
          </div>

          <div className="gcode-drawer-actions">
            <label className="gcode-toggle">
              <input
                type="checkbox"
                checked={wrapLines}
                onChange={(event) => setWrapLines(event.target.checked)}
              />
              <span>自动换行</span>
            </label>
            <button
              type="button"
              className="ghost-button"
              onClick={() => navigator.clipboard.writeText(gcode).catch(() => null)}
            >
              复制全文
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div className="gcode-drawer-toolbar">
          <input
            className="gcode-search-input"
            type="text"
            placeholder="搜索 G / M / X / Y / Z / 注释"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="gcode-toolbar-stats">
            <span className="metric-badge">轨迹代码</span>
            <span className="metric-badge">行号</span>
            <span className="metric-badge">轻量高亮</span>
          </div>
        </div>

        <div className={`gcode-viewer ${wrapLines ? "wrapped" : ""}`}>
          {visibleLines.length === 0 ? (
            <div className="gcode-empty-state">没有匹配到包含 “{search}” 的代码行。</div>
          ) : (
            visibleLines.map(({ content, lineNumber }) => (
              <div className="gcode-line" key={`${lineNumber}-${content}`}>
                <span className="gcode-line-number">{lineNumber}</span>
                <code className="gcode-line-content">{renderHighlightedLine(content, search)}</code>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function renderHighlightedLine(line: string, search: string) {
  const rawTokens = tokenizeLine(line);
  if (!search.trim()) {
    return rawTokens.map((token, index) => (
      <span key={`${token.className}-${index}`} className={token.className}>
        {token.text}
      </span>
    ));
  }

  const keyword = search.toLowerCase();
  return rawTokens.map((token, index) => {
    if (!token.text.toLowerCase().includes(keyword)) {
      return (
        <span key={`${token.className}-${index}`} className={token.className}>
          {token.text}
        </span>
      );
    }

    const parts = splitMatch(token.text, keyword);
    return (
      <span key={`${token.className}-${index}`} className={token.className}>
        {parts.map((part, partIndex) =>
          part.match ? (
            <mark key={partIndex} className="gcode-search-hit">
              {part.text}
            </mark>
          ) : (
            <span key={partIndex}>{part.text}</span>
          )
        )}
      </span>
    );
  });
}

function tokenizeLine(line: string): RenderToken[] {
  const matches = [...line.matchAll(TOKEN_PATTERN)];
  if (matches.length === 0) {
    return [{ text: line || " ", className: "gcode-text" }];
  }

  const tokens: RenderToken[] = [];
  let cursor = 0;

  for (const match of matches) {
    const value = match[0] ?? "";
    const start = match.index ?? 0;

    if (start > cursor) {
      tokens.push({
        text: line.slice(cursor, start),
        className: "gcode-text"
      });
    }

    tokens.push({
      text: value,
      className: classifyToken(value)
    });

    cursor = start + value.length;
  }

  if (cursor < line.length) {
    tokens.push({
      text: line.slice(cursor),
      className: "gcode-text"
    });
  }

  return tokens.length > 0 ? tokens : [{ text: " ", className: "gcode-text" }];
}

function classifyToken(token: string): string {
  const upper = token.toUpperCase();
  if (upper.startsWith(";") || upper.startsWith("//") || upper.startsWith("(")) {
    return "gcode-comment";
  }
  if (upper.startsWith("G")) {
    return "gcode-command";
  }
  if (upper.startsWith("M")) {
    return "gcode-machine";
  }
  if (/^[XYZIJKR]/i.test(token)) {
    return "gcode-axis";
  }
  if (/^[FSNP]/i.test(token)) {
    return "gcode-feed";
  }
  return "gcode-text";
}

function splitMatch(text: string, keyword: string) {
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const found = lower.indexOf(keyword, cursor);
    if (found === -1) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }

    if (found > cursor) {
      parts.push({ text: text.slice(cursor, found), match: false });
    }

    parts.push({ text: text.slice(found, found + keyword.length), match: true });
    cursor = found + keyword.length;
  }

  return parts;
}
