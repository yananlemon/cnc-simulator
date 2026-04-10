import React from "react";

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export function LoadingOverlay({ visible, message = "正在解析 G-code..." }: LoadingOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="loading-overlay">
      <div className="loading-overlay-content">
        <div className="loading-spinner-large"></div>
        <p className="loading-message">{message}</p>
      </div>
    </div>
  );
}
