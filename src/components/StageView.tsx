import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  PCFSoftShadowMap
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  MotionPoint,
  MotionSegment,
  SimulationPreviewFrame,
  SimulationResult,
  StockConfig,
  ToolConfig
} from "../features/simulation/simulator";

interface StageViewProps {
  fileName: string;
  simulation: SimulationResult | null;
  previewFrame: SimulationPreviewFrame | null;
  stock: StockConfig;
  tool: ToolConfig;
  status: string;
  currentToolPosition: MotionPoint | null;
  isSimulating: boolean;
  showToolpath?: boolean;
  toolpathSegments?: MotionSegment[];
}

interface ReliefState {
  group: Group;
  mesh: Mesh;
  frontWall: Mesh;
  backWall: Mesh;
  leftWall: Mesh;
  rightWall: Mesh;
  gridWidth: number;
  gridHeight: number;
  fullDetailReady: boolean;
}

export function StageView({
  fileName,
  simulation,
  previewFrame,
  stock,
  tool,
  status,
  currentToolPosition,
  isSimulating,
  showToolpath,
  toolpathSegments
}: StageViewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const stockGroupRef = useRef<Group | null>(null);
  const stockShellRef = useRef<Group | null>(null);
  const finalReliefStateRef = useRef<ReliefState | null>(null);
  const previewReliefStateRef = useRef<ReliefState | null>(null);
  const toolIndicatorRef = useRef<Group | null>(null);
  const toolpathLinesRef = useRef<LineSegments | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const finalApplyRafRef = useRef<number | null>(null);

  const stats = useMemo(() => {
    const surface = simulation ?? previewFrame;
    if (!surface) {
      return null;
    }

    return `网格 ${surface.gridWidth} x ${surface.gridHeight} · 去除体积 ${surface.removedVolumeMm3.toFixed(1)} mm³ · 表面高度 ${surface.minSurfaceZMm.toFixed(2)} 到 ${surface.maxSurfaceZMm.toFixed(2)} mm`;
  }, [previewFrame, simulation]);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) {
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#0a1320");
    sceneRef.current = scene;

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);
    const camera = new PerspectiveCamera(42, width / height, 0.1, 5000);
    camera.position.set(
      stock.widthMm * 1.45,
      -stock.heightMm * 1.1,
      Math.max(stock.thicknessMm * 3.8, Math.max(stock.widthMm, stock.heightMm) * 0.55)
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(new Vector3(stock.widthMm * 0.5, stock.heightMm * 0.5, stock.thicknessMm * 0.32));
    cameraRef.current = camera;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(stock.widthMm * 0.5, stock.heightMm * 0.5, stock.thicknessMm * 0.3);
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.minDistance = Math.max(stock.widthMm, stock.heightMm) * 0.8;
    controls.maxDistance = Math.max(stock.widthMm, stock.heightMm) * 6;
    controlsRef.current = controls;

    scene.add(new AmbientLight("#c8deff", 0.4));

    const keyLight = new DirectionalLight("#fff5df", 4.5);
    // 把光打得极度侧边，强行凸显出一切微弱和圆润的凹凸起伏阴影
    keyLight.position.set(-stock.widthMm * 2.0, -stock.heightMm * 2.0, stock.thicknessMm * 2.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0005;
    const shadowRange = Math.max(stock.widthMm, stock.heightMm) * 1.2;
    keyLight.shadow.camera.left = -shadowRange;
    keyLight.shadow.camera.right = shadowRange;
    keyLight.shadow.camera.top = shadowRange;
    keyLight.shadow.camera.bottom = -shadowRange;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 1000;
    scene.add(keyLight);

    const fillLight = new DirectionalLight("#60a0ff", 0.5);
    fillLight.position.set(stock.widthMm * 2.0, stock.heightMm * 0.5, stock.thicknessMm * 1.5);
    scene.add(fillLight);

    const rimLight = new DirectionalLight("#ffe1b5", 1.5);
    rimLight.position.set(stock.widthMm * 0.5, stock.heightMm * 1.8, stock.thicknessMm * 8);
    scene.add(rimLight);

    const stockGroup = new Group();
    stockGroupRef.current = stockGroup;
    scene.add(stockGroup);

    const grid = createWorkGrid(stock);
    scene.add(grid);

    const axesGroup = createAxisGuides(stock);
    scene.add(axesGroup);

    

    const finalState = createReliefState(
      stock,
      simulation?.gridWidth ?? null,
      simulation?.gridHeight ?? null,
      false
    );
    finalReliefStateRef.current = finalState;
    stockGroup.add(finalState.group);
    applySimulationToRelief(finalState, simulation, stock);

    const previewState = createReliefState(
      stock,
      previewFrame?.gridWidth ?? null,
      previewFrame?.gridHeight ?? null,
      true
    );
    previewState.mesh.visible = false;
    previewReliefStateRef.current = previewState;
    stockGroup.add(previewState.group);
    resetReliefMesh(previewState, stock);

    const toolIndicator = createToolIndicator(tool, stock);
    toolIndicator.visible = false;
    toolIndicatorRef.current = toolIndicator;
    stockGroup.add(toolIndicator);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);

    const handleResize = () => {
      const nextWidth = Math.max(container.clientWidth, 320);
      const nextHeight = Math.max(container.clientHeight, 320);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (finalApplyRafRef.current !== null) {
        window.cancelAnimationFrame(finalApplyRafRef.current);
      }

      controls.dispose();
      renderer.dispose();
      disposeGroup(axesGroup);
      disposeGroup(toolIndicator);
      disposeGroup(finalState.group);
      disposeGroup(previewState.group);
      grid.geometry.dispose();
      grid.material.dispose();

      finalReliefStateRef.current = null;
      previewReliefStateRef.current = null;
      toolIndicatorRef.current = null;
      stockGroupRef.current = null;
      controlsRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
      rendererRef.current = null;
      container.innerHTML = "";
    };
  }, [stock, tool]);

  useEffect(() => {
    const reliefState = ensureReliefState(
      finalReliefStateRef,
      stockGroupRef,
      stock,
      simulation?.gridWidth ?? null,
      simulation?.gridHeight ?? null,
      false
    );

    if (!reliefState) {
      return;
    }

    if (finalApplyRafRef.current !== null) {
      window.cancelAnimationFrame(finalApplyRafRef.current);
      finalApplyRafRef.current = null;
    }

    if (!simulation) {
      applySimulationToRelief(reliefState, null, stock);
      reliefState.mesh.visible = !isSimulating;
      reliefState.frontWall.visible = !isSimulating;
      reliefState.backWall.visible = !isSimulating;
      reliefState.leftWall.visible = !isSimulating;
      reliefState.rightWall.visible = !isSimulating;
      return;
    }

    const positions = reliefState.mesh.geometry.getAttribute("position") as BufferAttribute;
    let colorAttr = reliefState.mesh.geometry.getAttribute("color") as BufferAttribute | undefined;
    if (!colorAttr) {
      const count = positions.count;
      colorAttr = new Float32BufferAttribute(new Float32Array(count * 3), 3);
      reliefState.mesh.geometry.setAttribute("color", colorAttr);
    }

    reliefState.mesh.visible = false;
    reliefState.frontWall.visible = false;
    reliefState.backWall.visible = false;
    reliefState.leftWall.visible = false;
    reliefState.rightWall.visible = false;

    const minH = simulation.minSurfaceZMm;
    const maxH = simulation.maxSurfaceZMm;
    const range = Math.max(0.001, maxH - minH);
    const chunkSize = 24000;
    let cursor = 0;

    const finalizeMesh = () => {
      reliefState.mesh.geometry.computeVertexNormals();
      reliefState.mesh.geometry.getAttribute("position").needsUpdate = true;
      reliefState.mesh.geometry.getAttribute("normal").needsUpdate = true;
      updateReliefWalls(reliefState, stock, (row, col) => sampleDisplayHeight(simulation, row, col));
      reliefState.mesh.visible = true;
      reliefState.frontWall.visible = true;
      reliefState.backWall.visible = true;
      reliefState.leftWall.visible = true;
      reliefState.rightWall.visible = true;
      reliefState.fullDetailReady = true;
      finalApplyRafRef.current = null;
    };

    const applyChunk = () => {
      const end = Math.min(cursor + chunkSize, positions.count);
      for (let index = cursor; index < end; index += 1) {
        const row = Math.floor(index / reliefState.gridWidth);
        const col = index - row * reliefState.gridWidth;
        const sourceHeight = sampleDisplayHeight(simulation, row, col);
        positions.setZ(index, stock.thicknessMm + sourceHeight);
        const t = (sourceHeight - minH) / range;
        colorAttr!.setXYZ(index, 0.12 + t * 0.83, 0.1 + t * 0.78, 0.08 + t * 0.67);
      }

      positions.needsUpdate = true;
      colorAttr!.needsUpdate = true;
      cursor = end;

      if (cursor < positions.count) {
        finalApplyRafRef.current = window.requestAnimationFrame(applyChunk);
        return;
      }

      finalApplyRafRef.current = window.requestAnimationFrame(finalizeMesh);
    };

    finalApplyRafRef.current = window.requestAnimationFrame(applyChunk);

    return () => {
      if (finalApplyRafRef.current !== null) {
        window.cancelAnimationFrame(finalApplyRafRef.current);
        finalApplyRafRef.current = null;
      }
    };
  }, [simulation, stock, isSimulating]);

  useEffect(() => {
    const setReliefVisibility = (state: ReliefState | null, visible: boolean) => {
      if (!state) return;
      state.mesh.visible = visible;
      state.frontWall.visible = visible;
      state.backWall.visible = visible;
      state.leftWall.visible = visible;
      state.rightWall.visible = visible;
    };

    setReliefVisibility(finalReliefStateRef.current, !isSimulating);

    if (isSimulating) {
      const previewState = ensureReliefState(
        previewReliefStateRef,
        stockGroupRef,
        stock,
        previewFrame?.gridWidth ?? null,
        previewFrame?.gridHeight ?? null,
        true
      );
      if (previewState) {
        resetReliefMesh(previewState, stock);
        setReliefVisibility(previewState, false);
      }
    } else {
      setReliefVisibility(previewReliefStateRef.current, false);
    }
  }, [isSimulating, stock]);

  useEffect(() => {
    if (!previewFrame) {
      if (previewReliefStateRef.current) {
        previewReliefStateRef.current.mesh.visible = false;
      }
      return;
    }

    const previewState = ensureReliefState(
      previewReliefStateRef,
      stockGroupRef,
      stock,
      previewFrame.gridWidth,
      previewFrame.gridHeight,
      true
    );

    if (!previewState) {
      return;
    }

    previewState.mesh.visible = isSimulating;
    previewState.frontWall.visible = false;
    previewState.backWall.visible = false;
    previewState.leftWall.visible = false;
    previewState.rightWall.visible = false;
    applyPreviewPatchToRelief(previewState, previewFrame, stock);
  }, [previewFrame, isSimulating, stock]);

  useEffect(() => {
    const toolIndicator = toolIndicatorRef.current;
    if (!toolIndicator) {
      return;
    }

    if (!isSimulating || !currentToolPosition) {
      toolIndicator.visible = false;
      return;
    }

    const toolHeight = Math.max(stock.thicknessMm * 0.9, tool.diameterMm * 1.8);
    toolIndicator.visible = true;
    toolIndicator.position.set(
      currentToolPosition.x - stock.originXMm,
      currentToolPosition.y - stock.originYMm,
      stock.thicknessMm + currentToolPosition.z
    );
  }, [currentToolPosition, isSimulating, stock]);

  useEffect(() => {
    const parentGroup = stockGroupRef.current;
    if (!parentGroup) return;

    if (!showToolpath || !toolpathSegments || toolpathSegments.length === 0) {
      if (toolpathLinesRef.current) {
        toolpathLinesRef.current.visible = false;
      }
      return;
    }

    if (!toolpathLinesRef.current) {
      const material = new LineBasicMaterial({
        color: "#1fbfff",
        linewidth: 1,
        transparent: true,
        opacity: 0.8
      });
      const geometry = new BufferGeometry();
      const lineMesh = new LineSegments(geometry, material);
      parentGroup.add(lineMesh);
      toolpathLinesRef.current = lineMesh;
    }

    const lineMesh = toolpathLinesRef.current;
    lineMesh.visible = true;

    // Build float32 array for line segments
    const pts = new Float32Array(toolpathSegments.length * 6);
    let offset = 0;
    for (let index = 0; index < toolpathSegments.length; index += 1) {
      const seg = toolpathSegments[index];
      // Start point
      pts[offset++] = seg.start.x - stock.originXMm;
      pts[offset++] = seg.start.y - stock.originYMm;
      pts[offset++] = stock.thicknessMm + seg.start.z;
      // End point
      pts[offset++] = seg.end.x - stock.originXMm;
      pts[offset++] = seg.end.y - stock.originYMm;
      pts[offset++] = stock.thicknessMm + seg.end.z;
    }

    lineMesh.geometry.setAttribute("position", new BufferAttribute(pts, 3));
    lineMesh.geometry.computeBoundingSphere();
  }, [showToolpath, toolpathSegments, stock]);

  return (
    <section className="stage-view">
      <div className="stock-preview live-preview">
        <div ref={viewportRef} className="viewport-3d" />
        <div className="stock-label">{fileName}</div>
      </div>
      <div className="stage-overlay">
        <p>仿真视图</p>
        <span>{stats ?? status}</span>
        <div className="axis-legend">
          <span className="axis axis-x">X</span>
          <span className="axis axis-y">Y</span>
          <span className="axis axis-z">Z</span>
        </div>
      </div>
    </section>
  );
}

function createReliefState(
  stock: StockConfig,
  gridWidth: number | null,
  gridHeight: number | null,
  isPreview: boolean
): ReliefState {
  const resolvedGridWidth = Math.max(2, gridWidth ?? Math.ceil(stock.widthMm / stock.resolutionMm) + 1);
  const resolvedGridHeight = Math.max(2, gridHeight ?? Math.ceil(stock.heightMm / stock.resolutionMm) + 1);
  const mesh = createReliefMesh(stock, resolvedGridWidth, resolvedGridHeight, isPreview);
  const group = new Group();
  const frontWall = createWallMesh(isPreview);
  const backWall = createWallMesh(isPreview);
  const leftWall = createWallMesh(isPreview);
  const rightWall = createWallMesh(isPreview);
  group.add(mesh, frontWall, backWall, leftWall, rightWall);
  return {
    group,
    mesh,
    frontWall,
    backWall,
    leftWall,
    rightWall,
    gridWidth: resolvedGridWidth,
    gridHeight: resolvedGridHeight,
    fullDetailReady: false
  };
}

function createReliefMesh(
  stock: StockConfig,
  gridWidth: number,
  gridHeight: number,
  isPreview: boolean
): Mesh {
  const geometry = new PlaneGeometry(
    stock.widthMm,
    stock.heightMm,
    Math.max(1, gridWidth - 1),
    Math.max(1, gridHeight - 1)
  );
  geometry.translate(stock.widthMm * 0.5, stock.heightMm * 0.5, stock.thicknessMm);

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.05,
    transparent: false,
    opacity: 1,
    polygonOffset: true,
    polygonOffsetFactor: isPreview ? -4 : -2,
    polygonOffsetUnits: isPreview ? -4 : -2
  });

  // Initialize vertex colors to default wood color
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = 0.85;
    colors[i * 3 + 1] = 0.73;
    colors[i * 3 + 2] = 0.56;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));

  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createWallMesh(isPreview: boolean): Mesh {
  const mesh = new Mesh(
    new BufferGeometry(),
    new MeshStandardMaterial({
      color: isPreview ? "#d7b781" : "#8b7457",
      roughness: 0.88,
      metalness: 0.02,
      transparent: isPreview,
      opacity: isPreview ? 0.95 : 1,
      polygonOffset: true,
      polygonOffsetFactor: isPreview ? -3 : -1,
      polygonOffsetUnits: isPreview ? -3 : -1
    })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function syncSimulationMesh(
  reliefRef: MutableRefObject<ReliefState | null>,
  stockGroupRef: MutableRefObject<Group | null>,
  stock: StockConfig,
  simulation: SimulationResult | null,
  isPreview: boolean
): void {
  const reliefState = ensureReliefState(
    reliefRef,
    stockGroupRef,
    stock,
    simulation?.gridWidth ?? null,
    simulation?.gridHeight ?? null,
    isPreview
  );

  if (!reliefState) {
    return;
  }

  applySimulationToRelief(reliefState, simulation, stock);
}

function ensureReliefState(
  reliefRef: MutableRefObject<ReliefState | null>,
  stockGroupRef: MutableRefObject<Group | null>,
  stock: StockConfig,
  gridWidth: number | null,
  gridHeight: number | null,
  isPreview: boolean
): ReliefState | null {
  const stockGroup = stockGroupRef.current;
  if (!stockGroup) {
    return null;
  }

  const nextGridWidth = Math.max(2, gridWidth ?? Math.ceil(stock.widthMm / stock.resolutionMm) + 1);
  const nextGridHeight = Math.max(2, gridHeight ?? Math.ceil(stock.heightMm / stock.resolutionMm) + 1);
  let reliefState = reliefRef.current;

  const needsRebuild =
    !reliefState ||
    reliefState.gridWidth !== nextGridWidth ||
    reliefState.gridHeight !== nextGridHeight;

  if (needsRebuild) {
    if (reliefState) {
      stockGroup.remove(reliefState.group);
      disposeGroup(reliefState.group);
    }

    reliefState = createReliefState(stock, nextGridWidth, nextGridHeight, isPreview);
    reliefRef.current = reliefState;
    stockGroup.add(reliefState.group);
  }

  return reliefState;
}

function applySimulationToRelief(
  reliefState: ReliefState,
  simulation: SimulationResult | null,
  stock: StockConfig
): void {
  const positions = reliefState.mesh.geometry.getAttribute("position") as BufferAttribute;
  let colorAttr = reliefState.mesh.geometry.getAttribute("color") as BufferAttribute | undefined;
  if (!colorAttr) {
    const count = positions.count;
    const colorsArr = new Float32Array(count * 3);
    colorAttr = new Float32BufferAttribute(colorsArr, 3);
    reliefState.mesh.geometry.setAttribute("color", colorAttr);
  }

  const minH = simulation?.minSurfaceZMm ?? 0;
  const maxH = simulation?.maxSurfaceZMm ?? 0;
  const range = Math.max(0.001, maxH - minH);

  for (let row = 0; row < reliefState.gridHeight; row += 1) {
    for (let col = 0; col < reliefState.gridWidth; col += 1) {
      const index = row * reliefState.gridWidth + col;
      const sourceHeight = simulation ? sampleDisplayHeight(simulation, row, col) : 0;
      positions.setZ(index, stock.thicknessMm + sourceHeight);

      // Height-based vertex coloring: deep=nearly black, high=bright cream
      const t = range > 0.001 ? (sourceHeight - minH) / range : 1;
      // Deep color: rgb(0.12, 0.10, 0.08) -> High color: rgb(0.95, 0.88, 0.75)
      colorAttr.setXYZ(
        index,
        0.12 + t * 0.83,
        0.10 + t * 0.78,
        0.08 + t * 0.67
      );
    }
  }

  positions.needsUpdate = true;
  colorAttr.needsUpdate = true;
  reliefState.mesh.geometry.computeVertexNormals();
  updateReliefWalls(reliefState, stock, (row, col) => (simulation ? sampleDisplayHeight(simulation, row, col) : 0));
  reliefState.fullDetailReady = true;
}

let previewPatchCounter = 0;

function applyPreviewPatchToRelief(
  reliefState: ReliefState,
  previewFrame: SimulationPreviewFrame,
  stock: StockConfig
): void {
  const positions = reliefState.mesh.geometry.getAttribute("position") as BufferAttribute;
  let colorAttr = reliefState.mesh.geometry.getAttribute("color") as BufferAttribute | undefined;
  if (!colorAttr) {
    const count = positions.count;
    const colorsArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colorsArr[i * 3] = 0.88;
      colorsArr[i * 3 + 1] = 0.78;
      colorsArr[i * 3 + 2] = 0.62;
    }
    colorAttr = new Float32BufferAttribute(colorsArr, 3);
    reliefState.mesh.geometry.setAttribute("color", colorAttr);
  }
  const patchWidth = previewFrame.patch.maxCol - previewFrame.patch.minCol + 1;

  // Get height range from the preview frame
  const minH = previewFrame.minSurfaceZMm;
  const maxH = previewFrame.maxSurfaceZMm;
  const range = maxH - minH;

  for (let sourceRow = previewFrame.patch.minRow; sourceRow <= previewFrame.patch.maxRow; sourceRow += 1) {
    const rowOffset = sourceRow - previewFrame.patch.minRow;
    const meshRow = previewFrame.gridHeight - 1 - sourceRow;

    for (let col = previewFrame.patch.minCol; col <= previewFrame.patch.maxCol; col += 1) {
      const colOffset = col - previewFrame.patch.minCol;
      const patchIndex = rowOffset * patchWidth + colOffset;
      const vertexIndex = meshRow * reliefState.gridWidth + col;
      const h = previewFrame.patch.heights[patchIndex];
      positions.setZ(vertexIndex, stock.thicknessMm + h);

      const t = range > 0.001 ? (h - minH) / range : 1;
      colorAttr.setXYZ(
        vertexIndex,
        0.12 + t * 0.83,
        0.10 + t * 0.78,
        0.08 + t * 0.67
      );
    }
  }

  positions.needsUpdate = true;
  colorAttr.needsUpdate = true;

  // During playback keep the main thread light: avoid rebuilding normals and wall meshes on every preview patch.
  previewPatchCounter += 1;
  if (previewPatchCounter % 24 === 0) {
    reliefState.mesh.geometry.computeVertexNormals();
  }
  reliefState.fullDetailReady = false;
}

function resetReliefMesh(reliefState: ReliefState, stock: StockConfig): void {
  const positions = reliefState.mesh.geometry.getAttribute("position") as BufferAttribute;

  for (let index = 0; index < positions.count; index += 1) {
    positions.setZ(index, stock.thicknessMm);
  }

  positions.needsUpdate = true;
  reliefState.mesh.geometry.computeVertexNormals();
  updateReliefWalls(reliefState, stock, () => 0);
  reliefState.fullDetailReady = true;
}

function createToolIndicator(tool: ToolConfig, stock: StockConfig): Group {
  const group = new Group();
  const radius = Math.max(tool.diameterMm * 0.5, 0.4);
  const toolHeight = Math.max(stock.thicknessMm * 0.9, tool.diameterMm * 2.5);

  const metalMaterial = new MeshStandardMaterial({
    color: "#31353b",
    roughness: 0.22,
    metalness: 0.9,
  });

  const tipMaterial = new MeshStandardMaterial({
    color: "#3a3e45",
    roughness: 0.18,
    metalness: 0.95,
  });

  const shaftGeom = new CylinderGeometry(radius, radius, toolHeight, 24);
  shaftGeom.rotateX(Math.PI / 2);
  const shaft = new Mesh(shaftGeom, metalMaterial);
  shaft.castShadow = true;
  shaft.receiveShadow = true;

  if (tool.toolType === "ball_nose") {
    const tipGeom = new SphereGeometry(radius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    tipGeom.rotateX(Math.PI / 2);
    tipGeom.translate(0, 0, radius);
    const tip = new Mesh(tipGeom, tipMaterial);
    tip.castShadow = true;
    tip.receiveShadow = true;
    group.add(tip);
    shaft.position.set(0, 0, toolHeight * 0.5 + radius);
  } else if (tool.toolType === "v_bit") {
    const halfAngle = Math.max(1, tool.angleDeg * 0.5) * (Math.PI / 180);
    const coneHeight = radius / Math.tan(halfAngle);
    const tipGeom = new ConeGeometry(radius, coneHeight, 24);
    tipGeom.rotateX(Math.PI / 2);
    tipGeom.translate(0, 0, coneHeight * 0.5);
    const tip = new Mesh(tipGeom, tipMaterial);
    tip.castShadow = true;
    tip.receiveShadow = true;
    group.add(tip);
    shaft.position.set(0, 0, toolHeight * 0.5 + coneHeight);
  } else {
    // Flat End Mill
    shaft.position.set(0, 0, toolHeight * 0.5);
  }

  group.add(shaft);
  return group;
}

function createAxisGuides(stock: StockConfig): Group {
  const group = new Group();
  const axisLength = Math.max(stock.widthMm, stock.heightMm, stock.thicknessMm * 4) * 1.15;

  group.add(
    createAxisLine([0, 0, 0], [axisLength, 0, 0], "#ff5a5a"),
    createAxisLine([0, 0, 0], [0, axisLength, 0], "#62d96b"),
    createAxisLine([0, 0, 0], [0, 0, Math.max(stock.thicknessMm * 1.8, 18)], "#4da3ff")
  );

  const helper = new AxesHelper(Math.max(stock.thicknessMm * 0.8, 6));
  group.add(helper);

  const origin = new Mesh(
    new SphereGeometry(Math.max(stock.thicknessMm * 0.04, 0.5), 20, 20),
    new MeshStandardMaterial({
      color: "#fff7d6",
      roughness: 0.4,
      metalness: 0.1
    })
  );
  group.add(origin);

  return group;
}

function createWorkGrid(stock: StockConfig): GridHelper {
  const size = Math.max(stock.widthMm, stock.heightMm) * 2.4;
  const divisions = Math.max(20, Math.round(size / 10));
  const grid = new GridHelper(size, divisions, "#35c3ff", "#27465f");
  grid.rotateX(Math.PI / 2);
  grid.position.set(size * 0.5, size * 0.5, 0);
  return grid;
}

function createAxisLine(
  start: [number, number, number],
  end: [number, number, number],
  color: string
): Line {
  const geometry = new BufferGeometry().setFromPoints([new Vector3(...start), new Vector3(...end)]);
  return new Line(geometry, new LineBasicMaterial({ color, linewidth: 2 }));
}

function createStockBody(stock: StockConfig): Group {
  const group = new Group();
  const material = new MeshStandardMaterial({
    color: "#8b7457",
    roughness: 0.94,
    metalness: 0.02
  });

  const bottom = new Mesh(
    new BoxGeometry(stock.widthMm, stock.heightMm, stock.thicknessMm),
    material.clone()
  );
  bottom.position.set(stock.widthMm * 0.5, stock.heightMm * 0.5, stock.thicknessMm * 0.5);
  bottom.castShadow = true;
  bottom.receiveShadow = true;
  group.add(bottom);

  return group;
}

function sampleDisplayHeight(simulation: SimulationResult, row: number, col: number): number {
  const flippedRow = simulation.gridHeight - 1 - row;
  const sourceIndex = flippedRow * simulation.gridWidth + col;
  return simulation.heights[sourceIndex] ?? 0;
}

function samplePreviewHeight(preview: SimulationPreviewFrame, row: number, col: number): number {
  const sourceRow = preview.gridHeight - 1 - row;
  if (
    sourceRow < preview.patch.minRow ||
    sourceRow > preview.patch.maxRow ||
    col < preview.patch.minCol ||
    col > preview.patch.maxCol
  ) {
    return 0;
  }

  const patchWidth = preview.patch.maxCol - preview.patch.minCol + 1;
  const rowOffset = sourceRow - preview.patch.minRow;
  const colOffset = col - preview.patch.minCol;
  return preview.patch.heights[rowOffset * patchWidth + colOffset] ?? 0;
}

function updateReliefWalls(
  reliefState: ReliefState,
  stock: StockConfig,
  sampleHeight: (row: number, col: number) => number
): void {
  updateWallGeometry(reliefState.frontWall, buildFrontWall(reliefState, stock, sampleHeight));
  updateWallGeometry(reliefState.backWall, buildBackWall(reliefState, stock, sampleHeight));
  updateWallGeometry(reliefState.leftWall, buildLeftWall(reliefState, stock, sampleHeight));
  updateWallGeometry(reliefState.rightWall, buildRightWall(reliefState, stock, sampleHeight));
}

function buildFrontWall(
  reliefState: ReliefState,
  stock: StockConfig,
  sampleHeight: (row: number, col: number) => number
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const y = -0.02;

  for (let col = 0; col < reliefState.gridWidth; col += 1) {
    const x = (col / Math.max(1, reliefState.gridWidth - 1)) * stock.widthMm;
    const topZ = stock.thicknessMm + sampleHeight(reliefState.gridHeight - 1, col);
    positions.push(x, y, topZ, x, y, 0);
  }

  for (let col = 0; col < reliefState.gridWidth - 1; col += 1) {
    const base = col * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  return geometryFromArrays(positions, indices);
}

function buildBackWall(
  reliefState: ReliefState,
  stock: StockConfig,
  sampleHeight: (row: number, col: number) => number
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const y = stock.heightMm + 0.02;

  for (let col = 0; col < reliefState.gridWidth; col += 1) {
    const x = (col / Math.max(1, reliefState.gridWidth - 1)) * stock.widthMm;
    const topZ = stock.thicknessMm + sampleHeight(0, col);
    positions.push(x, y, topZ, x, y, 0);
  }

  for (let col = 0; col < reliefState.gridWidth - 1; col += 1) {
    const base = col * 2;
    indices.push(base + 2, base + 1, base, base + 2, base + 3, base + 1);
  }

  return geometryFromArrays(positions, indices);
}

function buildLeftWall(
  reliefState: ReliefState,
  stock: StockConfig,
  sampleHeight: (row: number, col: number) => number
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const x = -0.02;

  for (let row = 0; row < reliefState.gridHeight; row += 1) {
    const y = (row / Math.max(1, reliefState.gridHeight - 1)) * stock.heightMm;
    const topZ = stock.thicknessMm + sampleHeight(row, 0);
    positions.push(x, y, topZ, x, y, 0);
  }

  for (let row = 0; row < reliefState.gridHeight - 1; row += 1) {
    const base = row * 2;
    indices.push(base + 2, base + 1, base, base + 2, base + 3, base + 1);
  }

  return geometryFromArrays(positions, indices);
}

function buildRightWall(
  reliefState: ReliefState,
  stock: StockConfig,
  sampleHeight: (row: number, col: number) => number
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const x = stock.widthMm + 0.02;

  for (let row = 0; row < reliefState.gridHeight; row += 1) {
    const y = (row / Math.max(1, reliefState.gridHeight - 1)) * stock.heightMm;
    const topZ = stock.thicknessMm + sampleHeight(row, reliefState.gridWidth - 1);
    positions.push(x, y, topZ, x, y, 0);
  }

  for (let row = 0; row < reliefState.gridHeight - 1; row += 1) {
    const base = row * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  return geometryFromArrays(positions, indices);
}

function geometryFromArrays(positions: number[], indices: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function updateWallGeometry(mesh: Mesh, geometry: BufferGeometry): void {
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material.dispose());
  } else {
    mesh.material.dispose();
  }
}

function disposeGroup(group: Group): void {
  group.traverse((child) => {
    if (child instanceof Mesh) {
      disposeMesh(child);
      return;
    }

    if (child instanceof Line) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}
