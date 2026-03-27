export type ToolType = "ball_nose" | "flat_end_mill" | "v_bit";
type HeightBuffer = Float32Array<ArrayBufferLike>;

export interface StockConfig {
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  resolutionMm: number;
  originXMm: number;
  originYMm: number;
}

export interface ToolConfig {
  toolType: ToolType;
  diameterMm: number;
  angleDeg: number;
}

export interface MotionPoint {
  x: number;
  y: number;
  z: number;
}

export interface MotionSegment {
  start: MotionPoint;
  end: MotionPoint;
  rapid: boolean;
  lineNumber: number;
  motionType: "line" | "arc_cw" | "arc_ccw";
}

export interface ParseOverview {
  segmentCount: number;
  cuttingSegmentCount: number;
  arcSegmentCount: number;
  min: MotionPoint;
  max: MotionPoint;
}

export interface SimulationResult {
  overview: ParseOverview;
  gridWidth: number;
  gridHeight: number;
  stock: StockConfig;
  cellResolutionMm: number;
  minSurfaceZMm: number;
  maxSurfaceZMm: number;
  removedVolumeMm3: number;
  estimatedCutPixels: number;
  heights: HeightBuffer;
}

export interface SimulationProgress {
  stage: string;
  completedSegments: number;
  totalSegments: number;
  percent: number;
  currentPoint: MotionPoint | null;
}

export interface SimulationPatch {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  heights: HeightBuffer;
}

export interface SimulationPreviewFrame {
  overview: ParseOverview;
  frameIndex: number;
  completedSegments: number;
  totalSegments: number;
  percent: number;
  currentPoint: MotionPoint | null;
  generatedAtMs: number;
  timelineMs: number;
  gridWidth: number;
  gridHeight: number;
  stock: StockConfig;
  cellResolutionMm: number;
  minSurfaceZMm: number;
  maxSurfaceZMm: number;
  removedVolumeMm3: number;
  estimatedCutPixels: number;
  patch: SimulationPatch;
}

interface DirtyRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

interface ModalState {
  x: number;
  y: number;
  z: number;
  rapid: boolean;
  motionType: "line" | "arc_cw" | "arc_ccw";
  absolute: boolean;
  unitScale: number;
}

const DEFAULT_POINT: MotionPoint = { x: 0, y: 0, z: 0 };

export function getSampleGcode(): string {
  return `G21
G90
G0 X5 Y5 Z5
G1 Z-1.2 F300
G1 X55 Y5 F800
G1 X55 Y20
G1 X5 Y20
G1 X5 Y5
G0 Z5`;
}

export function getArcSampleGcode(): string {
  return `G21
G90
G0 X10 Y10 Z5
G1 Z-1.5 F300
G2 X40 Y10 I15 J0 F600
G2 X10 Y10 I-15 J0
G0 Z5`;
}

export function parseGcode(gcode: string): { segments: MotionSegment[]; overview: ParseOverview } {
  const state: ModalState = {
    x: 0,
    y: 0,
    z: 0,
    rapid: true,
    motionType: "line",
    absolute: true,
    unitScale: 1
  };

  const segments: MotionSegment[] = [];
  let min = { ...DEFAULT_POINT };
  let max = { ...DEFAULT_POINT };
  let hasBounds = false;

  gcode.split(/\r?\n/).forEach((rawLine, index) => {
    const cleaned = stripComments(rawLine).trim();
    if (!cleaned) {
      return;
    }

    const next: ModalState = { ...state };
    let moved = false;
    let arcI: number | null = null;
    let arcJ: number | null = null;

    tokenize(cleaned).forEach((token) => {
      const letter = token[0]?.toUpperCase();
      const value = Number(token.slice(1));
      if (Number.isNaN(value)) {
        return;
      }

      switch (letter) {
        case "G":
          if (value === 0) {
            next.rapid = true;
            next.motionType = "line";
          }
          if (value === 1) {
            next.rapid = false;
            next.motionType = "line";
          }
          if (value === 2) {
            next.rapid = false;
            next.motionType = "arc_cw";
          }
          if (value === 3) {
            next.rapid = false;
            next.motionType = "arc_ccw";
          }
          if (value === 20) next.unitScale = 25.4;
          if (value === 21) next.unitScale = 1;
          if (value === 90) next.absolute = true;
          if (value === 91) next.absolute = false;
          break;
        case "X":
          next.x = resolveAxis(state.x, value, next);
          moved = true;
          break;
        case "Y":
          next.y = resolveAxis(state.y, value, next);
          moved = true;
          break;
        case "Z":
          next.z = resolveAxis(state.z, value, next);
          moved = true;
          break;
        case "I":
          arcI = value * next.unitScale;
          break;
        case "J":
          arcJ = value * next.unitScale;
          break;
        default:
          break;
      }
    });

    if (moved) {
      const segmentList =
        next.motionType === "line"
          ? [
              {
                start: { x: state.x, y: state.y, z: state.z },
                end: { x: next.x, y: next.y, z: next.z },
                rapid: next.rapid,
                lineNumber: index + 1,
                motionType: "line" as const
              }
            ]
          : linearizeArc(
              { x: state.x, y: state.y, z: state.z },
              { x: next.x, y: next.y, z: next.z },
              next.motionType,
              arcI,
              arcJ,
              index + 1
            );

      segments.push(...segmentList);

      if (!hasBounds && segmentList.length > 0) {
        min = { ...segmentList[0].start };
        max = { ...segmentList[0].start };
        hasBounds = true;
      }

      segmentList.forEach((segment) => {
        accumulateBounds(segment.start, min, max);
        accumulateBounds(segment.end, min, max);
      });
    }

    Object.assign(state, next);
  });

  const cuttingSegmentCount = segments.filter((segment) => !segment.rapid).length;
  const arcSegmentCount = segments.filter((segment) => segment.motionType !== "line").length;

  return {
    segments,
    overview: {
      segmentCount: segments.length,
      cuttingSegmentCount,
      arcSegmentCount,
      min: hasBounds ? min : { ...DEFAULT_POINT },
      max: hasBounds ? max : { ...DEFAULT_POINT }
    }
  };
}

export function simulateGcode(gcode: string, stock: StockConfig, tool: ToolConfig): SimulationResult {
  const finalResolutionMm = deriveFinalResolution(stock, tool);
  const { segments, overview, gridWidth, gridHeight, heights, estimatedCutPixels } = runSimulationCore(
    gcode,
    stock,
    tool,
    finalResolutionMm
  );

  const processedHeights = postProcessHeights(heights, gridWidth, gridHeight, stock);
  const summary = summarizeHeights(processedHeights, finalResolutionMm);

  return {
    overview,
    gridWidth,
    gridHeight,
    stock,
    cellResolutionMm: finalResolutionMm,
    minSurfaceZMm: summary.minSurfaceZMm,
    maxSurfaceZMm: summary.maxSurfaceZMm,
    removedVolumeMm3: summary.removedVolumeMm3,
    estimatedCutPixels,
    heights: processedHeights
  };
}

export async function simulateGcodeWithProgress(
  gcode: string,
  stock: StockConfig,
  tool: ToolConfig,
  getSpeedMultiplier: (() => number) | number = 1.0,
  onProgress?: (progress: SimulationProgress) => void,
  onPreview?: (preview: SimulationPreviewFrame) => void
): Promise<SimulationResult> {
  const speedGetter = typeof getSpeedMultiplier === "function" ? getSpeedMultiplier : () => getSpeedMultiplier;
  const { segments, overview } = parseGcode(gcode);
  const previewResolutionMm = derivePreviewResolution(stock, tool);
  const finalResolutionMm = deriveFinalResolution(stock, tool);
  const gridWidth = Math.max(2, Math.ceil(stock.widthMm / previewResolutionMm) + 1);
  const gridHeight = Math.max(2, Math.ceil(stock.heightMm / previewResolutionMm) + 1);
  const heights = new Float32Array(gridWidth * gridHeight);
  const cuttingSegments = segments.filter((segment) => !segment.rapid);
  const totalSegments = cuttingSegments.length;
  let estimatedCutPixels = 0;
  let lastReportAt = -Infinity;
  let batchesSinceYield = 0;
  let previewFrameIndex = 0;
  let accumulatedDirtyRange: DirtyRange | null = null;
  let segmentsSincePreview = 0;
  let lastPreviewPoint: MotionPoint | null = null;

  onProgress?.({
    stage: "准备仿真",
    completedSegments: 0,
    totalSegments,
    percent: 0,
    currentPoint: cuttingSegments[0]?.start ?? null
  });

  for (let start = 0; start < totalSegments; ) {
    const speed = speedGetter();
    const batchSize = derivePreviewBatchSize(speed, totalSegments);
    const end = Math.min(totalSegments, start + batchSize);
    let dirtyRange: DirtyRange | null = null;

    for (let index = start; index < end; index += 1) {
      estimatedCutPixels += applySegment(
        cuttingSegments[index],
        tool,
        stock,
        heights,
        gridWidth,
        gridHeight,
        previewResolutionMm,
        (row, col) => {
          dirtyRange = mergeDirtyRange(dirtyRange, row, col);
        }
      );
    }

    const completedSegments = end;
    const percent = Math.round((completedSegments / Math.max(totalSegments, 1)) * 100);
    const now = performance.now();
    const currentPoint = cuttingSegments[Math.max(0, completedSegments - 1)]?.end ?? null;

    if (dirtyRange) {
      accumulatedDirtyRange = mergeDirtyRanges(accumulatedDirtyRange, dirtyRange);
    }
    segmentsSincePreview += end - start;

    // Keep preview generation dense and deterministic; playback speed is controlled on the main thread.
    const reportIntervalMs = 80;

    if (completedSegments >= totalSegments || now - lastReportAt >= reportIntervalMs) {
      onProgress?.({
        stage: "正在仿真",
        completedSegments,
        totalSegments,
        percent,
        currentPoint
      });
      lastReportAt = now;
    }

    const shouldEmitPreview =
      accumulatedDirtyRange !== null &&
      (completedSegments >= totalSegments ||
        segmentsSincePreview >= derivePreviewEmitSegmentThreshold(speed) ||
        movedEnoughForPreview(lastPreviewPoint, currentPoint, previewResolutionMm) ||
        dirtyRangeLargeEnough(accumulatedDirtyRange, gridWidth, gridHeight));

    if (shouldEmitPreview && accumulatedDirtyRange) {
      const summary = summarizeHeights(heights, previewResolutionMm);
      onPreview?.({
        overview,
        frameIndex: previewFrameIndex,
        completedSegments,
        totalSegments,
        percent,
        currentPoint,
        generatedAtMs: now,
        timelineMs: previewFrameIndex * 16,
        gridWidth,
        gridHeight,
        stock,
        cellResolutionMm: previewResolutionMm,
        minSurfaceZMm: summary.minSurfaceZMm,
        maxSurfaceZMm: summary.maxSurfaceZMm,
        removedVolumeMm3: summary.removedVolumeMm3,
        estimatedCutPixels,
        patch: buildSimulationPatch(heights, accumulatedDirtyRange, gridWidth)
      });
      previewFrameIndex += 1;
      accumulatedDirtyRange = null;
      segmentsSincePreview = 0;
      lastPreviewPoint = currentPoint;
    }

    start += batchSize;
    batchesSinceYield += 1;

    const yieldEvery = speed >= 12 ? 4 : speed >= 4 ? 3 : 2;
    if (start < totalSegments && batchesSinceYield >= yieldEvery) {
      batchesSinceYield = 0;
      await waitForNextFrame();
    }
  }

  const processedHeights = postProcessHeights(
    heights,
    gridWidth,
    gridHeight,
    stock
  );
  const summary = summarizeHeights(processedHeights, previewResolutionMm);

  return {
    overview,
    gridWidth,
    gridHeight,
    stock,
    cellResolutionMm: previewResolutionMm,
    minSurfaceZMm: summary.minSurfaceZMm,
    maxSurfaceZMm: summary.maxSurfaceZMm,
    removedVolumeMm3: summary.removedVolumeMm3,
    estimatedCutPixels,
    heights: processedHeights
  };
}

function runSimulationCore(
  gcode: string,
  stock: StockConfig,
  tool: ToolConfig,
  resolutionMm = stock.resolutionMm
) {
  const { segments, overview } = parseGcode(gcode);
  const gridWidth = Math.max(2, Math.ceil(stock.widthMm / resolutionMm) + 1);
  const gridHeight = Math.max(2, Math.ceil(stock.heightMm / resolutionMm) + 1);
  const heights = new Float32Array(gridWidth * gridHeight);
  let estimatedCutPixels = 0;

  segments.forEach((segment) => {
    if (segment.rapid) {
      return;
    }

    estimatedCutPixels += applySegment(
      segment,
      tool,
      stock,
      heights,
      gridWidth,
      gridHeight,
      resolutionMm
    );
  });

  return { segments, overview, gridWidth, gridHeight, heights, estimatedCutPixels };
}

function summarizeHeights(heights: HeightBuffer, resolutionMm: number) {
  let minSurfaceZMm = 0;
  let maxSurfaceZMm = 0;
  let removedVolumeMm3 = 0;
  const cellArea = resolutionMm * resolutionMm;

  heights.forEach((height) => {
    minSurfaceZMm = Math.min(minSurfaceZMm, height);
    maxSurfaceZMm = Math.max(maxSurfaceZMm, height);
    removedVolumeMm3 += Math.max(0, -height) * cellArea;
  });

  return { minSurfaceZMm, maxSurfaceZMm, removedVolumeMm3 };
}

function buildSimulationPatch(
  heights: HeightBuffer,
  dirtyRange: DirtyRange,
  gridWidth: number
): SimulationPatch {
  const patchWidth = dirtyRange.maxCol - dirtyRange.minCol + 1;
  const patchHeight = dirtyRange.maxRow - dirtyRange.minRow + 1;
  const patchHeights = new Float32Array(patchWidth * patchHeight);

  for (let row = dirtyRange.minRow; row <= dirtyRange.maxRow; row += 1) {
    const rowOffset = row - dirtyRange.minRow;
    for (let col = dirtyRange.minCol; col <= dirtyRange.maxCol; col += 1) {
      const colOffset = col - dirtyRange.minCol;
      patchHeights[rowOffset * patchWidth + colOffset] = heights[row * gridWidth + col];
    }
  }

  return {
    minRow: dirtyRange.minRow,
    maxRow: dirtyRange.maxRow,
    minCol: dirtyRange.minCol,
    maxCol: dirtyRange.maxCol,
    heights: patchHeights
  };
}

function postProcessHeights(
  heights: HeightBuffer,
  gridWidth: number,
  gridHeight: number,
  stock: StockConfig
): HeightBuffer {
  let current: HeightBuffer = new Float32Array(heights);
  const passes = stock.resolutionMm <= 0.08 ? 1 : 0;

  for (let pass = 0; pass < passes; pass += 1) {
    current = smoothHeightField(current, gridWidth, gridHeight, stock.thicknessMm);
  }

  return current;
}

function smoothHeightField(
  source: HeightBuffer,
  gridWidth: number,
  gridHeight: number,
  thicknessMm: number
): HeightBuffer {
  const target: HeightBuffer = new Float32Array(source);
  const kernel = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1]
  ];

  for (let row = 1; row < gridHeight - 1; row += 1) {
    for (let col = 1; col < gridWidth - 1; col += 1) {
      const index = row * gridWidth + col;
      const center = source[index];
      if (center > -0.015) {
        continue;
      }

      let sum = 0;
      let weightSum = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const sample = source[(row + ky) * gridWidth + (col + kx)];
          const kernelWeight = kernel[ky + 1][kx + 1];
          const similarity = 1 / (1 + Math.abs(sample - center) * 18);
          const weight = kernelWeight * similarity;
          sum += sample * weight;
          weightSum += weight;
        }
      }

      const blended = sum / Math.max(0.0001, weightSum);
      target[index] = Math.max(-thicknessMm, Math.min(center * 0.82 + blended * 0.18, 0));
    }
  }

  return target;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function derivePreviewResolution(stock: StockConfig, tool: ToolConfig): number {
  return Math.max(stock.resolutionMm, Math.min(tool.diameterMm / 24, 0.12));
}

function deriveFinalResolution(stock: StockConfig, tool: ToolConfig): number {
  return Math.max(0.01, Math.min(stock.resolutionMm, tool.diameterMm / 20, 0.08));
}

function derivePreviewBatchSize(speed: number, totalSegments: number): number {
  if (speed <= 1) {
    return Math.max(3, Math.min(6, Math.ceil(totalSegments / 2400) || 4));
  }
  if (speed <= 2) {
    return 2;
  }
  if (speed <= 4) {
    return 3;
  }
  if (speed <= 8) {
    return 4;
  }
  return Math.max(4, Math.min(12, Math.ceil(totalSegments / 1200) || 6));
}

function derivePreviewEmitSegmentThreshold(speed: number): number {
  if (speed <= 1) {
    return 6;
  }
  if (speed <= 2) {
    return 4;
  }
  if (speed <= 4) {
    return 3;
  }
  return 2;
}

function movedEnoughForPreview(
  previous: MotionPoint | null,
  current: MotionPoint | null,
  resolutionMm: number
): boolean {
  if (!previous || !current) {
    return true;
  }
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const dz = current.z - previous.z;
  return Math.hypot(dx, dy, dz) >= Math.max(resolutionMm * 1.2, 0.12);
}

function dirtyRangeLargeEnough(
  dirtyRange: DirtyRange,
  gridWidth: number,
  gridHeight: number
): boolean {
  const patchWidth = dirtyRange.maxCol - dirtyRange.minCol + 1;
  const patchHeight = dirtyRange.maxRow - dirtyRange.minRow + 1;
  const patchArea = patchWidth * patchHeight;
  const totalArea = gridWidth * gridHeight;
  return patchArea >= Math.max(96, totalArea * 0.0035);
}

function mergeDirtyRanges(current: DirtyRange | null, next: DirtyRange | null): DirtyRange | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return {
    minRow: Math.min(current.minRow, next.minRow),
    maxRow: Math.max(current.maxRow, next.maxRow),
    minCol: Math.min(current.minCol, next.minCol),
    maxCol: Math.max(current.maxCol, next.maxCol)
  };
}

export function exportSimulationToStl(
  simulation: SimulationResult,
  solidName = "cnc_simulator_relief"
): string {
  const { stock, gridWidth, gridHeight, heights, cellResolutionMm } = simulation;
  const lines: string[] = [`solid ${solidName}`];

  for (let row = 0; row < gridHeight - 1; row += 1) {
    for (let col = 0; col < gridWidth - 1; col += 1) {
      const p00 = vertexAt(row, col, gridWidth, heights, stock, cellResolutionMm);
      const p10 = vertexAt(row, col + 1, gridWidth, heights, stock, cellResolutionMm);
      const p01 = vertexAt(row + 1, col, gridWidth, heights, stock, cellResolutionMm);
      const p11 = vertexAt(row + 1, col + 1, gridWidth, heights, stock, cellResolutionMm);

      appendTriangle(lines, p00, p10, p11);
      appendTriangle(lines, p00, p11, p01);
    }
  }

  lines.push(`endsolid ${solidName}`);
  return `${lines.join("\n")}\n`;
}

function applySegment(
  segment: MotionSegment,
  tool: ToolConfig,
  stock: StockConfig,
  heights: HeightBuffer,
  gridWidth: number,
  gridHeight: number,
  resolutionMm: number,
  onCellCut?: (row: number, col: number) => void
): number {
  const radius = tool.diameterMm * 0.5;
  const padding = resolutionMm * 0.5;
  const minX = Math.min(segment.start.x, segment.end.x) - radius - padding;
  const maxX = Math.max(segment.start.x, segment.end.x) + radius + padding;
  const minY = Math.min(segment.start.y, segment.end.y) - radius - padding;
  const maxY = Math.max(segment.start.y, segment.end.y) + radius + padding;

  const minCol = Math.max(0, Math.floor((minX - stock.originXMm) / resolutionMm));
  const maxCol = Math.min(gridWidth - 1, Math.ceil((maxX - stock.originXMm) / resolutionMm));
  const minRow = Math.max(0, Math.floor((minY - stock.originYMm) / resolutionMm));
  const maxRow = Math.min(gridHeight - 1, Math.ceil((maxY - stock.originYMm) / resolutionMm));

  let touched = 0;
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const cellIndex = row * gridWidth + col;
      const existingHeight = heights[cellIndex];
      const nextHeight = sampleSweptRemovalAtCell(
        segment,
        tool,
        stock,
        row,
        col,
        existingHeight,
        resolutionMm
      );
      if (nextHeight < existingHeight) {
        heights[cellIndex] = nextHeight;
        touched += 1;
        onCellCut?.(row, col);
      }
    }
  }
  return touched;
}

function computeCutSurface(zTip: number, radial: number, tool: ToolConfig): number {
  if (tool.toolType === "flat_end_mill") {
    return zTip;
  }

  if (tool.toolType === "ball_nose") {
    const radius = tool.diameterMm * 0.5;
    const offset = radius - Math.sqrt(Math.max(0, radius * radius - radial * radial));
    return zTip + offset;
  }

  const halfAngle = Math.tan((tool.angleDeg * Math.PI) / 360);
  if (halfAngle <= 0) {
    return zTip;
  }
  return zTip + radial / halfAngle;
}

function sampleSweptRemovalAtCell(
  segment: MotionSegment,
  tool: ToolConfig,
  stock: StockConfig,
  row: number,
  col: number,
  existingHeight: number,
  resolutionMm: number
): number {
  const quarter = resolutionMm * 0.25;
  const edge = resolutionMm * 0.4;
  const centerX = stock.originXMm + col * resolutionMm;
  const centerY = stock.originYMm + row * resolutionMm;
  
  const offsets: Array<[number, number]> = [
    [0, 0],
    [-quarter, -quarter],
    [quarter, -quarter],
    [-quarter, quarter],
    [quarter, quarter],
    [-edge, 0],
    [edge, 0],
    [0, -edge],
    [0, edge]
  ];

  let best = existingHeight;
  for (const [ox, oy] of offsets) {
    const sampleX = centerX + ox;
    const sampleY = centerY + oy;
    const cutZ = computeSweptCutPoint(sampleX, sampleY, segment, tool);
    if (cutZ !== null && cutZ < best) {
      best = cutZ;
    }
  }

  return Math.max(-stock.thicknessMm, best);
}

function computeSweptCutPoint(
  px: number,
  py: number,
  segment: MotionSegment,
  tool: ToolConfig
): number | null {
  const radius = tool.diameterMm * 0.5;
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const dz = segment.end.z - segment.start.z;
  const lsq = dx * dx + dy * dy;

  if (lsq < 1e-12) {
    const r = Math.hypot(px - segment.start.x, py - segment.start.y);
    if (r > radius + 1e-6) return null;
    const zMin = Math.min(segment.start.z, segment.end.z);
    return computeCutSurface(zMin, Math.min(r, radius), tool);
  }

  const vx = segment.start.x - px;
  const vy = segment.start.y - py;
  
  const a = lsq;
  const b = 2.0 * (vx * dx + vy * dy);
  const c = vx * vx + vy * vy - radius * radius;
  const discriminant = b * b - 4.0 * a * c;

  if (discriminant < 0) return null;

  const sqrtD = Math.sqrt(discriminant);
  const t1 = (-b - sqrtD) / (2.0 * a);
  const t2 = (-b + sqrtD) / (2.0 * a);

  let tStart = Math.max(0, Math.min(1, t1));
  let tEnd = Math.max(0, Math.min(1, t2));
  if (tStart > tEnd) {
    const temp = tStart;
    tStart = tEnd;
    tEnd = temp;
  }

  if (tEnd === 0 && t1 < 0 && t2 < 0) return null;
  if (tStart === 1 && t1 > 1 && t2 > 1) return null;

  let bestZ = Infinity;
  const tClosest = (-b) / (2.0 * a);
  const evalPoints: number[] = [tStart, tEnd];
  
  if (tClosest > tStart && tClosest < tEnd) {
    evalPoints.push(tClosest);
    evalPoints.push((tStart + tClosest) * 0.5);
    evalPoints.push((tClosest + tEnd) * 0.5);
  } else {
    evalPoints.push((tStart + tEnd) * 0.5);
  }

  for (const t of evalPoints) {
    const r = Math.hypot(vx + t * dx, vy + t * dy);
    // Float precision causes r > radius at true boundary, skipping the cut entirely.
    const clampedR = Math.min(r, radius);
    const zTip = segment.start.z + t * dz;
    const cutZ = computeCutSurface(zTip, clampedR, tool);
    if (cutZ < bestZ) bestZ = cutZ;
  }

  return bestZ === Infinity ? null : bestZ;
}

function stripComments(line: string): string {
  return line
    .replace(/\([^)]*\)/g, " ")
    .replace(/;.*$/g, " ")
    .replace(/\/\/.*$/g, " ");
}

function tokenize(line: string): string[] {
  return line.match(/[A-Za-z][+\-]?\d*\.?\d*/g) ?? [];
}

function resolveAxis(current: number, value: number, state: ModalState): number {
  const scaled = value * state.unitScale;
  return state.absolute ? scaled : current + scaled;
}

function linearizeArc(
  start: MotionPoint,
  end: MotionPoint,
  motionType: "arc_cw" | "arc_ccw",
  arcI: number | null,
  arcJ: number | null,
  lineNumber: number
): MotionSegment[] {
  const centerX = start.x + (arcI ?? 0);
  const centerY = start.y + (arcJ ?? 0);
  const startAngle = Math.atan2(start.y - centerY, start.x - centerX);
  let endAngle = Math.atan2(end.y - centerY, end.x - centerX);
  const radius = Math.hypot(start.x - centerX, start.y - centerY);

  if (radius < 0.0001) {
    return [
      {
        start,
        end,
        rapid: false,
        lineNumber,
        motionType: "line"
      }
    ];
  }

  let sweep = endAngle - startAngle;
  if (motionType === "arc_cw" && sweep >= 0) {
    sweep -= Math.PI * 2;
  }
  if (motionType === "arc_ccw" && sweep <= 0) {
    sweep += Math.PI * 2;
  }

  const arcLength = Math.abs(sweep) * radius;
  const segments = Math.max(12, Math.ceil(arcLength / 0.25));
  const result: MotionSegment[] = [];

  let previous = start;
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const angle = startAngle + sweep * t;
    const point: MotionPoint = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      z: start.z + (end.z - start.z) * t
    };
    result.push({
      start: previous,
      end: point,
      rapid: false,
      lineNumber,
      motionType
    });
    previous = point;
  }

  return result;
}

function accumulateBounds(point: MotionPoint, min: MotionPoint, max: MotionPoint): void {
  min.x = Math.min(min.x, point.x);
  min.y = Math.min(min.y, point.y);
  min.z = Math.min(min.z, point.z);
  max.x = Math.max(max.x, point.x);
  max.y = Math.max(max.y, point.y);
  max.z = Math.max(max.z, point.z);
}

function mergeDirtyRange(current: DirtyRange | null, row: number, col: number): DirtyRange {
  if (!current) {
    return {
      minRow: row,
      maxRow: row,
      minCol: col,
      maxCol: col
    };
  }

  return {
    minRow: Math.min(current.minRow, row),
    maxRow: Math.max(current.maxRow, row),
    minCol: Math.min(current.minCol, col),
    maxCol: Math.max(current.maxCol, col)
  };
}

function vertexAt(
  row: number,
  col: number,
  gridWidth: number,
  heights: HeightBuffer,
  stock: StockConfig,
  resolutionMm: number
) {
  const index = row * gridWidth + col;
  return {
    x: stock.originXMm + col * resolutionMm,
    y: stock.originYMm + row * resolutionMm,
    z: stock.thicknessMm + (heights[index] ?? 0)
  };
}

function appendTriangle(
  lines: string[],
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number }
): void {
  const normal = triangleNormal(a, b, c);
  lines.push(`facet normal ${normal.x} ${normal.y} ${normal.z}`);
  lines.push("  outer loop");
  lines.push(`    vertex ${a.x} ${a.y} ${a.z}`);
  lines.push(`    vertex ${b.x} ${b.y} ${b.z}`);
  lines.push(`    vertex ${c.x} ${c.y} ${c.z}`);
  lines.push("  endloop");
  lines.push("endfacet");
}

function triangleNormal(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number }
) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;

  return {
    x: nx / length,
    y: ny / length,
    z: nz / length
  };
}
