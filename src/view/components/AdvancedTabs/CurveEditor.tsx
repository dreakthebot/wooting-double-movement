import { Button, HStack, Text, VStack, useColorModeValue } from "@chakra-ui/react";
import React, { useCallback, useEffect, useRef, useState } from "react";

export type CurvePoint = [number, number];

const powCurve = (p: number): CurvePoint[] =>
  [0.25, 0.5, 0.75].map((x) => [x, Math.pow(x, p)] as CurvePoint);

export const CURVE_PRESETS: { name: string; points: CurvePoint[] }[] = [
  { name: "Linear", points: powCurve(1) },
  { name: "Gentle", points: powCurve(1.5) },
  { name: "Very gentle", points: powCurve(2) },
  { name: "Sharp", points: powCurve(0.6) },
  {
    name: "S-curve",
    points: [
      [0.25, 0.1],
      [0.5, 0.5],
      [0.75, 0.9],
    ],
  },
];

/** Same maths as eval_curve in controller.rs: fixed ends, linear between points. */
export function evalCurve(points: CurvePoint[], v: number): number {
  // Work on copies: the caller's points must not be modified
  const inner = points
    .map((p) => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))] as CurvePoint)
    .filter((p) => p[0] > 0 && p[0] < 1)
    .sort((a, b) => a[0] - b[0]);
  const pts: CurvePoint[] = [[0, 0], ...inner, [1, 1]];
  let maxY = 0;
  for (const p of pts) {
    maxY = Math.max(maxY, p[1]);
    p[1] = maxY;
  }
  pts[pts.length - 1][1] = 1;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (v <= x1) return x1 - x0 <= 1e-6 ? y1 : y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
  }
  return 1;
}

const SIZE = 100;
const PAD = 8; // room for the handles at the edges, in viewBox units
const toX = (v: number) => PAD + v * (SIZE - 2 * PAD);
const toY = (v: number) => SIZE - PAD - v * (SIZE - 2 * PAD);

interface Props {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  /** Degrees a full press turns you, for the example sentence */
  fullAngle: number;
}

/**
 * Drag the points to shape how key depth (left to right) turns into output (bottom to top).
 * Changes are committed when the drag ends, so the app isn't flooded with updates.
 */
export function CurveEditor(props: Props) {
  const [draft, setDraft] = useState<CurvePoint[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const points = draft ?? props.points;

  const grid = useColorModeValue("#d6dcdc", "#334140");
  const ink = useColorModeValue("#1a2322", "#e5ecea");
  const muted = useColorModeValue("#7a8a88", "#8a9b98");
  const accent = useColorModeValue("#c46f12", "#f0a043");

  const pointFromEvent = useCallback((e: React.PointerEvent | PointerEvent): CurvePoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const vx = (((e.clientX - r.left) / r.width) * SIZE - PAD) / (SIZE - 2 * PAD);
    const vy = (SIZE - PAD - ((e.clientY - r.top) / r.height) * SIZE) / (SIZE - 2 * PAD);
    return [vx, vy];
  }, []);

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging === null) return;
      const p = pointFromEvent(e);
      if (!p) return;
      const next = points.map((q) => [...q] as CurvePoint);
      const minX = dragging === 0 ? 0.02 : next[dragging - 1][0] + 0.02;
      const maxX = dragging === next.length - 1 ? 0.98 : next[dragging + 1][0] - 0.02;
      const x = Math.min(maxX, Math.max(minX, p[0]));
      const y = Math.min(1, Math.max(0, p[1]));
      next[dragging] = [x, y];
      // Keep the curve rising: push neighbours instead of letting it dip
      for (let i = dragging + 1; i < next.length; i++) next[i][1] = Math.max(next[i][1], y);
      for (let i = dragging - 1; i >= 0; i--) next[i][1] = Math.min(next[i][1], y);
      setDraft(next);
    },
    [dragging, points, pointFromEvent]
  );

  const endDrag = useCallback(() => {
    if (dragging !== null && draft) props.onChange(draft.map((p) => [round(p[0]), round(p[1])] as CurvePoint));
    setDragging(null);
    setDraft(null);
  }, [dragging, draft, props.onChange]);

  useEffect(() => {
    if (dragging === null) return;
    window.addEventListener("pointerup", endDrag);
    return () => window.removeEventListener("pointerup", endDrag);
  }, [dragging, endDrag]);

  const curvePath = Array.from({ length: 51 }, (_, i) => {
    const v = i / 50;
    return `${i ? "L" : "M"}${toX(v).toFixed(2)},${toY(evalCurve(points, v)).toFixed(2)}`;
  }).join(" ");

  const half = evalCurve(points, 0.5);

  return (
    <VStack align="stretch" spacing="2">
      <HStack spacing="1" flexWrap="wrap">
        {CURVE_PRESETS.map((p) => (
          <Button key={p.name} size="xs" variant="outline" onClick={() => props.onChange(p.points)}>
            {p.name}
          </Button>
        ))}
      </HStack>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ width: "100%", maxWidth: 260, aspectRatio: "1", touchAction: "none", alignSelf: "center" }}
        onPointerMove={onMove}
        role="img"
        aria-label="Analog response curve editor"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={toX(g)} y1={toY(0)} x2={toX(g)} y2={toY(1)} stroke={grid} strokeWidth={0.4} />
            <line x1={toX(0)} y1={toY(g)} x2={toX(1)} y2={toY(g)} stroke={grid} strokeWidth={0.4} />
          </g>
        ))}
        <line x1={toX(0)} y1={toY(0)} x2={toX(1)} y2={toY(1)} stroke={muted} strokeWidth={0.5} strokeDasharray="2 2" />
        <path d={curvePath} fill="none" stroke={accent} strokeWidth={1.6} />
        <circle cx={toX(0)} cy={toY(0)} r={1.6} fill={ink} />
        <circle cx={toX(1)} cy={toY(1)} r={1.6} fill={ink} />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={toX(p[0])}
            cy={toY(p[1])}
            r={dragging === i ? 4.2 : 3.4}
            fill={accent}
            stroke={ink}
            strokeWidth={0.6}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragging(i);
            }}
          />
        ))}
      </svg>
      <HStack justify="space-between" fontSize="xs" color="gray.500">
        <Text>← light press</Text>
        <Text>full press →</Text>
      </HStack>
      <Text fontSize="sm">
        Pressing halfway gives <b>{Math.round(half * 100)}%</b>, about{" "}
        <b>{Math.round(half * props.fullAngle)}°</b> of turn with {"W"} held. A full press is always 100%.
      </Text>
    </VStack>
  );
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
