import { describe, it, expect } from "vitest";
import { parseGcode } from "./simulator";

// ---------------------------------------------------------------------------
// parseGcode — 单元测试
// ---------------------------------------------------------------------------

describe("parseGcode", () => {
  // ── 1. 空字符串 ────────────────────────────────────────────────────────────
  it("空 G-code 返回空段列表", () => {
    const { segments, overview } = parseGcode("");

    expect(segments).toHaveLength(0);
    expect(overview.segmentCount).toBe(0);
    expect(overview.cuttingSegmentCount).toBe(0);
    expect(overview.arcSegmentCount).toBe(0);
    // 无运动时包围盒应为原点
    expect(overview.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(overview.max).toEqual({ x: 0, y: 0, z: 0 });
  });

  // ── 2. G0 / G1 rapid 标志 ─────────────────────────────────────────────────
  it("G0 为快速移动，G1 为切削移动", () => {
    const gcode = [
      "G0 X10 Y0",
      "G1 X20 Y0",
    ].join("\n");

    const { segments } = parseGcode(gcode);

    expect(segments).toHaveLength(2);
    // G0 segment
    expect(segments[0].rapid).toBe(true);
    expect(segments[0].motionType).toBe("line");
    // G1 segment
    expect(segments[1].rapid).toBe(false);
    expect(segments[1].motionType).toBe("line");
  });

  // ── 3. 包围盒追踪 ─────────────────────────────────────────────────────────
  it("正确追踪运动包围盒", () => {
    // 运动路径：原点→(10,5,3)→(-5,20,-2)
    // 期望 min=(-5,0,-2), max=(10,20,3)
    const gcode = [
      "G0 X10 Y5 Z3",
      "G1 X-5 Y20 Z-2",
    ].join("\n");

    const { overview } = parseGcode(gcode);

    expect(overview.min.x).toBeCloseTo(-5);
    expect(overview.min.y).toBeCloseTo(0);   // 起点 y=0 是最小值
    expect(overview.min.z).toBeCloseTo(-2);
    expect(overview.max.x).toBeCloseTo(10);
    expect(overview.max.y).toBeCloseTo(20);
    expect(overview.max.z).toBeCloseTo(3);
  });

  // ── 4. G20 英制 → 公制自动转换 ───────────────────────────────────────────
  it("G20 英制单位坐标自动转毫米", () => {
    const gcode = [
      "G20",        // 切换到英制（1 inch = 25.4 mm）
      "G0 X1 Y2",
    ].join("\n");

    const { segments } = parseGcode(gcode);

    // G20 只设置了单位，没有运动，不产生 segment
    // G0 X1 Y2 → end = (1*25.4, 2*25.4, 0)
    expect(segments).toHaveLength(1);
    expect(segments[0].end.x).toBeCloseTo(25.4);
    expect(segments[0].end.y).toBeCloseTo(50.8);
  });

  // ── 5. G91 相对模式坐标累加 ───────────────────────────────────────────────
  it("G91 相对模式坐标正确累加", () => {
    const gcode = [
      "G91",        // 切换到相对模式
      "G0 X5 Y5",   // 从 (0,0,0) → (5,5,0)
      "G0 X3 Y2",   // 再移动 → (8,7,0)
      "G0 X0 Y0 Z-1", // z 方向 → (8,7,-1)
    ].join("\n");

    const { segments } = parseGcode(gcode);

    expect(segments).toHaveLength(3);
    expect(segments[0].end.x).toBeCloseTo(5);
    expect(segments[0].end.y).toBeCloseTo(5);
    expect(segments[1].end.x).toBeCloseTo(8);
    expect(segments[1].end.y).toBeCloseTo(7);
    expect(segments[2].end.z).toBeCloseTo(-1);
  });

  // ── 6. 激光模式检测：S-Max 头部 ──────────────────────────────────────────
  it("含 S-Max 头部时识别为激光模式", () => {
    // S-Max 注释出现在文件前 2048 字节内
    const gcode = [
      "; S-Max: 1000",
      "G1 X10 Y0 S500",
    ].join("\n");

    const { overview } = parseGcode(gcode);

    expect(overview.isLaserMode).toBe(true);
  });

  // ── 7. 激光模式：S 功率映射为 z 切深（负值） ──────────────────────────────
  it("激光模式 S 功率映射为切深", () => {
    // maxS = 1000 (来自 S-Max 头部)
    // S500  → intensity = 0.5 → z = -0.5
    // S1000 → intensity = 1.0 → z = -1.0
    const gcode = [
      "; S-Max: 1000",
      "G1 X10 Y0 S500",
      "G1 X20 Y0 S1000",
    ].join("\n");

    const { segments } = parseGcode(gcode);

    // 段 0: start=(0,0,0) → end=(10,0,-0.5)
    const seg0 = segments.find((s) => !s.rapid && Math.abs(s.end.x - 10) < 0.01);
    expect(seg0).toBeDefined();
    expect(seg0!.end.z).toBeCloseTo(-0.5);

    // 段 1: start=(10,0,-0.5) → end=(20,0,-1.0)
    const seg1 = segments.find((s) => !s.rapid && Math.abs(s.end.x - 20) < 0.01);
    expect(seg1).toBeDefined();
    expect(seg1!.end.z).toBeCloseTo(-1.0);
  });

  // ── 8. Z 轴命令 > 5 → 强制退出激光模式 ──────────────────────────────────
  it("Z 轴命令频繁时不识别为激光模式", () => {
    // 有 S-Max 头部 → 初始判定为激光模式
    // 但 Z 命令 6 次 > 5 → isLaserMode 被置为 false
    const lines = [
      "; S-Max: 1000",
      "G1 Z-1",
      "G1 Z-2",
      "G1 Z-3",
      "G1 Z-4",
      "G1 Z-5",
      "G1 Z-6",   // 第 6 个 Z 命令
    ];
    const { overview } = parseGcode(lines.join("\n"));

    expect(overview.isLaserMode).toBe(false);
  });

  // ── 9. cuttingSegmentCount 仅统计非 rapid 段 ─────────────────────────────
  it("cuttingSegmentCount 仅统计切削段", () => {
    const gcode = [
      "G0 X10 Y0",   // rapid  → 不计入
      "G1 X20 Y0",   // cutting
      "G1 X30 Y0",   // cutting
      "G0 X0 Y0",    // rapid  → 不计入
    ].join("\n");

    const { overview } = parseGcode(gcode);

    expect(overview.segmentCount).toBe(4);
    expect(overview.cuttingSegmentCount).toBe(2);
  });

  // ── 10. 分号注释不影响解析结果 ───────────────────────────────────────────
  it("分号注释不影响解析结果", () => {
    const gcodeWithComments = [
      "; 全行注释，应被忽略",
      "G0 X10 Y0  ; 行内注释",
      "; 另一条注释",
      "G1 X20 Y5",
    ].join("\n");

    const gcodeClean = [
      "G0 X10 Y0",
      "G1 X20 Y5",
    ].join("\n");

    const { segments: withComments, overview: ov1 } = parseGcode(gcodeWithComments);
    const { segments: clean, overview: ov2 } = parseGcode(gcodeClean);

    // 段数相同
    expect(ov1.segmentCount).toBe(ov2.segmentCount);
    expect(withComments).toHaveLength(clean.length);

    // 各段坐标相同
    withComments.forEach((seg, i) => {
      expect(seg.end.x).toBeCloseTo(clean[i].end.x);
      expect(seg.end.y).toBeCloseTo(clean[i].end.y);
      expect(seg.end.z).toBeCloseTo(clean[i].end.z);
      expect(seg.rapid).toBe(clean[i].rapid);
    });
  });
});
