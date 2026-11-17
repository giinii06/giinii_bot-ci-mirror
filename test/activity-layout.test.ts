import { expect, test } from "bun:test";
import {
  BASE_RADIUS,
  COLLIDE_GAP,
  MAX_LINK_GAP,
  MAX_SCALE,
  MIN_LINK_GAP,
  computeLinkWeights,
  computeNodeScales,
  createCollideForce,
  createGravityForce,
  linkDistanceFor,
  linkStrengthFor,
  type RenderNode,
} from "../activity/src/layout.js";
import type { GraphLink, GraphNode } from "../src/voice-graph-contract.js";

const node = (id: string, voiceMs: number): GraphNode => ({
  id,
  name: id.toUpperCase(),
  avatarPath: null,
  voiceMs,
  community: null,
});

const link = (source: string, target: string, sharedMs: number): GraphLink => ({
  source,
  target,
  sharedMs,
  kind: "mutual",
  visibleByDefault: true,
});

const renderNode = (
  id: string,
  scale: number,
  coords: { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number } = {},
): RenderNode => ({
  ...node(id, 0),
  scale,
  radius: BASE_RADIUS * scale,
  degree: 1,
  ...coords,
});

const distanceBetween = (a: RenderNode, b: RenderNode): number =>
  Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0), (b.z ?? 0) - (a.z ?? 0));

test("computeNodeScales defaults empty, all-zero, and single zero-time nodes to 1", () => {
  expect(computeNodeScales([])).toEqual(new Map());
  expect(computeNodeScales([node("a", 0)])).toEqual(new Map([["a", 1]]));
  expect(computeNodeScales([node("a", 0), node("b", 0), node("c", 0)])).toEqual(
    new Map([["a", 1], ["b", 1], ["c", 1]]),
  );
});

test("computeNodeScales scales monotonically up to MAX_SCALE and guards invalid values", () => {
  const scales = computeNodeScales([
    node("zero", 0),
    node("neg", -500),
    node("nan", Number.NaN),
    node("inf", Number.POSITIVE_INFINITY),
    node("low", 100),
    node("mid", 400),
    node("max", 1600),
  ]);

  expect(scales.get("zero")).toBe(1);
  expect(scales.get("neg")).toBe(1);
  expect(scales.get("nan")).toBe(1);
  expect(scales.get("inf")).toBe(1);
  expect(scales.get("max")).toBe(MAX_SCALE);
  expect(scales.get("low")!).toBeGreaterThan(1);
  expect(scales.get("mid")!).toBeGreaterThan(scales.get("low")!);
  expect(scales.get("max")!).toBeGreaterThan(scales.get("mid")!);
});

test("computeLinkWeights handles empty and non-positive links without NaN", () => {
  expect(computeLinkWeights([])).toEqual([]);
  expect(computeLinkWeights([
    link("a", "b", 0),
    link("b", "c", -10),
    link("c", "d", Number.NaN),
  ])).toEqual([0, 0, 0]);
});

test("stronger sharedMs yields higher weight, shorter link distance, and stronger pull", () => {
  const weights = computeLinkWeights([
    link("a", "b", 100),
    link("a", "c", 400),
    link("a", "d", 1600),
  ]);

  expect(weights[2]).toBe(1);
  expect(weights[1]).toBeGreaterThan(weights[0]!);
  expect(weights[2]).toBeGreaterThan(weights[1]!);

  const sourceRadius = BASE_RADIUS * MAX_SCALE;
  const targetRadius = BASE_RADIUS * 2;
  const distances = weights.map((w) => linkDistanceFor(sourceRadius, targetRadius, w));
  const strengths = weights.map((w) => linkStrengthFor(w, 3, 2));

  expect(distances[2]).toBe(sourceRadius + targetRadius + MIN_LINK_GAP);
  expect(distances[0]).toBeGreaterThan(distances[1]!);
  expect(distances[1]).toBeGreaterThan(distances[2]!);
  expect(linkDistanceFor(sourceRadius, targetRadius, 0)).toBe(
    sourceRadius + targetRadius + MAX_LINK_GAP,
  );

  expect(strengths[2]).toBeGreaterThan(strengths[1]!);
  expect(strengths[1]).toBeGreaterThan(strengths[0]!);
  expect(linkStrengthFor(1, 5, 2)).toBeCloseTo(0.5, 6);
  expect(linkStrengthFor(0, 0, -2)).toBeCloseTo(0.06, 6);
});

test("createCollideForce separates overlapping 3x orbs and coincident origin nodes", () => {
  const nodes = [
    renderNode("a", MAX_SCALE, { x: 0, y: 0, z: 0 }),
    renderNode("b", MAX_SCALE, { x: 0, y: 0, z: 0 }),
    renderNode("c", MAX_SCALE, { x: 1, y: 0.5, z: -0.5 }),
    renderNode("d", 1, { x: -2, y: 1, z: 0.5 }),
  ];

  const collide = createCollideForce();
  collide.initialize(nodes);
  collide(1);

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]!;
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(a.y)).toBe(true);
    expect(Number.isFinite(a.z)).toBe(true);
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j]!;
      const required = a.radius + b.radius + COLLIDE_GAP - 1e-3;
      expect(distanceBetween(a, b)).toBeGreaterThanOrEqual(required);
    }
  }
});

test("createGravityForce pulls isolated nodes toward the origin", () => {
  const nodes = [
    renderNode("pos", 1, { x: 100, y: -50, z: 25, vx: 0, vy: 0, vz: 0 }),
    renderNode("origin", 1, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }),
  ];

  const gravity = createGravityForce(0.04);
  gravity.initialize(nodes);
  gravity(0.5);

  expect(nodes[0]!.vx).toBeLessThan(0);
  expect(nodes[0]!.vy).toBeGreaterThan(0);
  expect(nodes[0]!.vz).toBeLessThan(0);
  expect(nodes[1]!.vx).toBe(0);
  expect(nodes[1]!.vy).toBe(0);
  expect(nodes[1]!.vz).toBe(0);
});
