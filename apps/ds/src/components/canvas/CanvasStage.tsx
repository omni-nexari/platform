import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Rect, Circle, Text, Line, Transformer, Group } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore } from '../../lib/canvasStore.js';
import type { CanvasElement } from '../../lib/canvasTypes.js';
import type { ReactNode } from 'react';

/** Renders the Konva stage with all elements for the current page */
export default function CanvasStage() {
  const {
    settings,
    selectedPageId,
    pages,
    selectedElementIds,
    selectElements,
    clearSelection,
    updateElement,
    zoom,
    stageX,
    stageY,
    setZoom,
    setStagePosition,
  } = useCanvasStore();

  const page = pages.find((p) => p.id === selectedPageId);
  const elements = page?.elements ?? [];

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  // Fit stage to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStageSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Attach transformer to selected nodes
  useEffect(() => {
    const tr = transformerRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;

    const nodes = selectedElementIds
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => n != null);

    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedElementIds, elements]);

  // Click on empty space → deselect
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === stageRef.current || e.target.attrs?.name === 'canvas-bg') {
      clearSelection();
    }
  }, [clearSelection]);

  // Click on element → select it
  const handleElementClick = useCallback((id: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const el = elements.find((el) => el.id === id);
    if (el?.locked) return;

    if (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey) {
      // Toggle multi-select
      if (selectedElementIds.includes(id)) {
        selectElements(selectedElementIds.filter((i) => i !== id));
      } else {
        selectElements([...selectedElementIds, id]);
      }
    } else {
      selectElements([id]);
    }
  }, [elements, selectedElementIds, selectElements]);

  // Handle element drag end
  const handleDragEnd = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    let x = node.x();
    let y = node.y();

    // Snap to grid
    const { snapToGrid, gridSize } = settings;
    if (snapToGrid) {
      x = Math.round(x / gridSize) * gridSize;
      y = Math.round(y / gridSize) * gridSize;
      node.position({ x, y });
    }

    updateElement(id, { x, y });
  }, [settings, updateElement]);

  // Handle transform end (resize / rotate)
  const handleTransformEnd = useCallback((id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Reset scale, apply to width/height instead
    node.scaleX(1);
    node.scaleY(1);

    updateElement(id, {
      x: node.x(),
      y: node.y(),
      width: Math.max(5, node.width() * scaleX),
      height: Math.max(5, node.height() * scaleY),
      rotation: node.rotation(),
    });
  }, [updateElement]);

  // Wheel zoom
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.08;
    const newScale = direction > 0 ? oldScale * factor : oldScale / factor;
    const clampedScale = Math.max(0.1, Math.min(5, newScale));

    const mousePointTo = {
      x: (pointer.x - stageX) / oldScale,
      y: (pointer.y - stageY) / oldScale,
    };

    setZoom(clampedScale);
    setStagePosition(
      pointer.x - mousePointTo.x * clampedScale,
      pointer.y - mousePointTo.y * clampedScale,
    );
  }, [zoom, stageX, stageY, setZoom, setStagePosition]);

  // ── Render element by type ──────────────────────────────────────────────

  function renderElement(el: CanvasElement) {
    const common = {
      id: el.id,
      x: el.x,
      y: el.y,
      rotation: el.rotation,
      opacity: el.opacity,
      draggable: !el.locked,
      visible: el.visible,
      onClick: (e: Konva.KonvaEventObject<MouseEvent>) => handleElementClick(el.id, e),
      onTap: (e: Konva.KonvaEventObject<Event>) => handleElementClick(el.id, e as unknown as Konva.KonvaEventObject<MouseEvent>),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleDragEnd(el.id, e),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => handleTransformEnd(el.id, e),
    };

    switch (el.type) {
      case 'rect':
        return (
          <Rect
            key={el.id}
            {...common}
            width={el.width}
            height={el.height}
            fill={el.fill}
            stroke={el.stroke || ''}
            strokeWidth={el.strokeWidth}
            cornerRadius={el.cornerRadius}
          />
        );

      case 'circle':
        return (
          <Circle
            key={el.id}
            {...common}
            // Konva Circle uses radius, so we center it
            x={el.x + el.width / 2}
            y={el.y + el.height / 2}
            radiusX={el.width / 2}
            radiusY={el.height / 2}
            fill={el.fill}
            stroke={el.stroke || ''}
            strokeWidth={el.strokeWidth}
            // Override for transformer compatibility
            offsetX={0}
            offsetY={0}
            scaleX={1}
            scaleY={1}
          />
        );

      case 'text':
        return (
          <Text
            key={el.id}
            {...common}
            width={el.width}
            height={el.height}
            text={el.text}
            fontSize={el.fontSize}
            fontFamily={el.fontFamily}
            fontStyle={el.fontStyle || 'normal'}
            textDecoration={el.textDecoration || ''}
            fill={el.fill}
            align={el.align}
            verticalAlign={el.verticalAlign}
            lineHeight={el.lineHeight}
            letterSpacing={el.letterSpacing}
            padding={el.padding}
            wrap="word"
          />
        );

      case 'line':
        return (
          <Line
            key={el.id}
            {...common}
            points={el.points}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
            lineCap={el.lineCap}
            lineJoin={el.lineJoin}
          />
        );

      default:
        return null;
    }
  }

  // ── Grid pattern ────────────────────────────────────────────────────────

  function renderGrid() {
    if (!settings.gridEnabled) return null;
    const lines: ReactNode[] = [];
    const { width, height, gridSize } = settings;
    const stroke = 'rgba(255,255,255,0.06)';

    for (let x = 0; x <= width; x += gridSize) {
      lines.push(
        <Line key={`gv-${x}`} points={[x, 0, x, height]} stroke={stroke} strokeWidth={0.5} listening={false} />
      );
    }
    for (let y = 0; y <= height; y += gridSize) {
      lines.push(
        <Line key={`gh-${y}`} points={[0, y, width, y]} stroke={stroke} strokeWidth={0.5} listening={false} />
      );
    }
    return <>{lines}</>;
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden bg-[#0d0d1a] relative">
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={zoom}
        scaleY={zoom}
        x={stageX}
        y={stageY}
        onClick={handleStageClick}
        onTap={handleStageClick as unknown as (evt: Konva.KonvaEventObject<TouchEvent>) => void}
        onWheel={handleWheel}
        draggable
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setStagePosition(e.target.x(), e.target.y());
          }
        }}
      >
        <Layer ref={layerRef}>
          {/* Canvas background */}
          <Rect
            name="canvas-bg"
            x={0}
            y={0}
            width={settings.width}
            height={settings.height}
            fill={settings.background}
            listening={true}
          />

          {/* Grid */}
          {renderGrid()}

          {/* Elements */}
          {elements.map(renderElement)}

          {/* Transformer */}
          <Transformer
            ref={transformerRef}
            rotateEnabled={true}
            borderStroke="#3b82f6"
            borderStrokeWidth={1.5}
            anchorFill="#3b82f6"
            anchorStroke="#1d4ed8"
            anchorSize={8}
            anchorCornerRadius={2}
            keepRatio={false}
            enabledAnchors={[
              'top-left', 'top-center', 'top-right',
              'middle-left', 'middle-right',
              'bottom-left', 'bottom-center', 'bottom-right',
            ]}
            boundBoxFunc={(oldBox, newBox) => {
              // Prevent negative dimensions
              if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) return oldBox;
              return newBox;
            }}
          />
        </Layer>
      </Stage>
    </div>
  );
}
