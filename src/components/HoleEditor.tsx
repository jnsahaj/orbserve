import { useEffect, useRef } from "react";
import {
  type Hole,
  type HoleSide,
  type ContainerSize,
  baseAnglesBySide,
  makeHole,
} from "@/lib/types";

interface Props {
  holes: Hole[];
  selected: number;
  viewport: { w: number; h: number };
  container: ContainerSize;
  onChange: (next: Hole[]) => void;
  onSelect: (idx: number) => void;
}

interface Bounds { left: number; top: number; width: number; height: number }

function makeBounds(viewport: { w: number; h: number }, c: ContainerSize): Bounds {
  return {
    left: viewport.w / 2 - c.w / 2,
    top: viewport.h / 2 - c.h / 2,
    width: c.w,
    height: c.h,
  };
}
function holeCenter(h: Hole, b: Bounds) {
  switch (h.side) {
    case "bottom": return { x: b.left + h.offset * b.width, y: b.top + b.height };
    case "top":    return { x: b.left + h.offset * b.width, y: b.top };
    case "left":   return { x: b.left,                       y: b.top + h.offset * b.height };
    case "right":  return { x: b.left + b.width,             y: b.top + h.offset * b.height };
  }
}
function holeTangent(h: Hole) {
  return h.side === "bottom" || h.side === "top"
    ? { x: 1, y: 0 } : { x: 0, y: 1 };
}
function projectOffset(side: HoleSide, x: number, y: number, b: Bounds) {
  if (side === "bottom" || side === "top") return clamp((x - b.left) / b.width, 0, 1);
  return clamp((y - b.top) / b.height, 0, 1);
}
function nearestSide(x: number, y: number, b: Bounds): HoleSide {
  const dB = Math.abs(y - (b.top + b.height));
  const dT = Math.abs(y - b.top);
  const dL = Math.abs(x - b.left);
  const dR = Math.abs(x - (b.left + b.width));
  const inX = x >= b.left && x <= b.left + b.width;
  const inY = y >= b.top  && y <= b.top  + b.height;
  let cand: [HoleSide, number][] = [];
  if (inX) cand.push(["bottom", dB], ["top", dT]);
  if (inY) cand.push(["left", dL], ["right", dR]);
  if (!cand.length) cand = [["bottom", dB], ["top", dT], ["left", dL], ["right", dR]];
  cand.sort((a, b) => a[1] - b[1]);
  return cand[0][0];
}
function clamp(v: number, a: number, c: number) { return Math.max(a, Math.min(c, v)); }
function snap(v: number, free: boolean) {
  return free ? v : Math.round(v * 20) / 20;
}

export function HoleEditor({
  holes, selected, viewport, container, onChange, onSelect,
}: Props) {
  const dragRef = useRef<{ kind: "move" | "rotate"; idx: number } | null>(null);

  // Read latest props inside the global pointer listener via refs so the
  // listener doesn't re-bind on every render (which would drop the drag).
  const holesRef = useRef(holes);
  const viewportRef = useRef(viewport);
  const containerRef = useRef(container);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    holesRef.current = holes;
    viewportRef.current = viewport;
    containerRef.current = container;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const b = makeBounds(viewportRef.current, containerRef.current);
      const hs = holesRef.current;
      if (drag.kind === "move") {
        const side = nearestSide(e.clientX, e.clientY, b);
        const off = projectOffset(side, e.clientX, e.clientY, b);
        onChangeRef.current(
          hs.map((h, i) =>
            i === drag.idx
              ? { ...h, side, offset: snap(clamp(off, 0, 1), e.shiftKey) }
              : h,
          ),
        );
      } else {
        const h = hs[drag.idx];
        const c = holeCenter(h, b);
        let rel = (Math.atan2(e.clientY - c.y, e.clientX - c.x) - baseAnglesBySide[h.side]) * 180 / Math.PI;
        while (rel > 180) rel -= 360;
        while (rel < -180) rel += 360;
        rel = clamp(rel, -90, 90);
        if (!e.shiftKey) rel = Math.round(rel / 5) * 5;
        onChangeRef.current(hs.map((hh, i) => (i === drag.idx ? { ...hh, angle: rel } : hh)));
      }
    };
    const handleUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const b = makeBounds(viewport, container);

  const onEdgeClick = (side: HoleSide, e: React.MouseEvent) => {
    const off = projectOffset(side, e.clientX, e.clientY, b);
    onChange([...holes, { ...makeHole(side), offset: snap(off, e.shiftKey) }]);
    onSelect(holes.length);
  };
  const onContextMenu = (idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (holes.length === 1) return;
    onChange(holes.filter((_, i) => i !== idx));
    onSelect(-1);
  };

  return (
    <svg
      data-hole-editor
      width={viewport.w}
      height={viewport.h}
      className="pointer-events-none fixed inset-0 z-[5]"
    >
      <rect
        x={b.left} y={b.top}
        width={b.width} height={b.height}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1}
        strokeDasharray="4 5"
      />
      {/* Edge hit zones — click to add a hole on that edge. */}
      {([
        ["bottom", b.left, b.top + b.height, b.left + b.width, b.top + b.height],
        ["top",    b.left, b.top,            b.left + b.width, b.top],
        ["left",   b.left, b.top,            b.left,            b.top + b.height],
        ["right",  b.left + b.width, b.top,  b.left + b.width,  b.top + b.height],
      ] as Array<[HoleSide, number, number, number, number]>).map(([side, x1, y1, x2, y2]) => (
        <line
          key={side}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="transparent"
          strokeWidth={26}
          className="cursor-copy hover:stroke-white/[0.04]"
          style={{ pointerEvents: "stroke" }}
          onClick={(e) => onEdgeClick(side, e)}
        />
      ))}
      {holes.map((h, idx) => {
        const c = holeCenter(h, b);
        const tang = holeTangent(h);
        const tangAngleDeg = Math.atan2(tang.y, tang.x) * 180 / Math.PI;
        const launchAngle = baseAnglesBySide[h.side] + (h.angle || 0) * Math.PI / 180;
        const dir = { x: Math.cos(launchAngle), y: Math.sin(launchAngle) };
        const arrowLen = 38;
        const ax = c.x + dir.x * arrowLen;
        const ay = c.y + dir.y * arrowLen;
        const perp = { x: -dir.y, y: dir.x };
        const headPoints = `${ax},${ay} ${ax - dir.x * 7 + perp.x * 4},${ay - dir.y * 7 + perp.y * 4} ${ax - dir.x * 7 - perp.x * 4},${ay - dir.y * 7 - perp.y * 4}`;
        const isSel = idx === selected;
        const stroke  = isSel ? "rgba(255,255,255,1)"     : "rgba(255,255,255,0.55)";
        const fill    = isSel ? "rgba(255,255,255,0.22)"  : "rgba(255,255,255,0.10)";
        return (
          <g
            key={idx}
            className="pointer-events-auto cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => {
              e.preventDefault();
              dragRef.current = { kind: "move", idx };
              onSelect(idx);
            }}
            onContextMenu={(e) => onContextMenu(idx, e)}
          >
            <rect
              x={-h.width / 2} y={-4}
              width={h.width} height={8}
              rx={2}
              fill={fill} stroke={stroke}
              strokeWidth={1.25}
              transform={`translate(${c.x},${c.y}) rotate(${tangAngleDeg})`}
            />
            <line
              x1={c.x} y1={c.y} x2={ax} y2={ay}
              stroke={stroke} strokeWidth={1.5}
              strokeLinecap="round"
              style={{ pointerEvents: "none" }}
            />
            <polygon
              points={headPoints}
              fill={stroke}
              style={{ pointerEvents: "none" }}
            />
            <circle
              cx={ax} cy={ay} r={6}
              fill="rgba(0,0,0,1)"
              stroke={stroke}
              strokeWidth={1.5}
              className="cursor-alias"
              style={{ pointerEvents: "auto" }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragRef.current = { kind: "rotate", idx };
                onSelect(idx);
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
