import type { GraphLink, GraphNode } from "../../src/voice-graph-contract.js";

export const BASE_RADIUS = 4;
export const MAX_SCALE = 3;
export const COLLIDE_GAP = 3.5;
export const MIN_LINK_GAP = 6;
export const MAX_LINK_GAP = 64;

const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

export type RenderNode = GraphNode & {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  scale: number;
  radius: number;
  degree: number;
};

export type RenderLink = Omit<GraphLink, "source" | "target"> & {
  sourceId: string;
  targetId: string;
  source: string | RenderNode;
  target: string | RenderNode;
  weight: number;
};

export type Force3D = {
  (alpha: number): void;
  initialize: (nodes: RenderNode[]) => void;
};

const positive = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

export const computeNodeScales = (nodes: readonly GraphNode[]): Map<string, number> => {
  let maxVoiceMs = 0;
  for (const node of nodes) {
    const voiceMs = positive(node.voiceMs);
    if (voiceMs > maxVoiceMs) maxVoiceMs = voiceMs;
  }

  const scales = new Map<string, number>();
  for (const node of nodes) {
    const voiceMs = positive(node.voiceMs);
    if (maxVoiceMs <= 0 || voiceMs <= 0) {
      scales.set(node.id, 1);
      continue;
    }
    scales.set(node.id, 1 + (MAX_SCALE - 1) * Math.sqrt(voiceMs / maxVoiceMs));
  }
  return scales;
};

export const computeLinkWeights = (links: readonly GraphLink[]): number[] => {
  let maxSharedMs = 0;
  for (const link of links) {
    const sharedMs = positive(link.sharedMs);
    if (sharedMs > maxSharedMs) maxSharedMs = sharedMs;
  }

  return links.map((link) => {
    const sharedMs = positive(link.sharedMs);
    if (maxSharedMs <= 0 || sharedMs <= 0) return 0;
    return Math.sqrt(sharedMs / maxSharedMs);
  });
};

export const linkDistanceFor = (
  sourceRadius: number,
  targetRadius: number,
  weight: number,
): number =>
  sourceRadius + targetRadius + MIN_LINK_GAP + (MAX_LINK_GAP - MIN_LINK_GAP) * (1 - weight);

export const linkStrengthFor = (
  weight: number,
  sourceDegree: number,
  targetDegree: number,
): number =>
  (0.06 + 0.94 * weight * weight) / Math.max(1, Math.min(sourceDegree, targetDegree));

const coincidentSeparationDirection = (i: number, j: number): [number, number, number] => {
  const theta = i * GOLDEN_ANGLE_RAD + j * 1.1;
  const z = (((i + j * 3) % 7) - 3) / 4;
  const planar = Math.sqrt(1 - z * z);
  return [planar * Math.cos(theta), planar * Math.sin(theta), z];
};

export const createCollideForce = (gap = COLLIDE_GAP, iterations = 5): Force3D => {
  let nodes: RenderNode[] = [];

  const run = (_alpha: number) => {
    const count = nodes.length;
    for (let pass = 0; pass < iterations; pass += 1) {
      for (let i = 0; i < count; i += 1) {
        const a = nodes[i]!;
        for (let j = i + 1; j < count; j += 1) {
          const b = nodes[j]!;
          const ax = a.x ?? 0;
          const ay = a.y ?? 0;
          const az = a.z ?? 0;
          const bx = b.x ?? 0;
          const by = b.y ?? 0;
          const bz = b.z ?? 0;
          const dx = bx - ax;
          const dy = by - ay;
          const dz = bz - az;
          const dist = Math.hypot(dx, dy, dz);
          const minDist = a.radius + b.radius + gap;
          if (dist >= minDist) continue;

          if (dist < 1e-6) {
            const [ux, uy, uz] = coincidentSeparationDirection(i, j);
            const half = minDist * 0.5;
            a.x = ax - ux * half;
            a.y = ay - uy * half;
            a.z = az - uz * half;
            b.x = bx + ux * half;
            b.y = by + uy * half;
            b.z = bz + uz * half;
            continue;
          }

          const push = ((minDist - dist) / dist) * 0.5;
          a.x = ax - dx * push;
          a.y = ay - dy * push;
          a.z = az - dz * push;
          b.x = bx + dx * push;
          b.y = by + dy * push;
          b.z = bz + dz * push;
        }
      }
    }
  };

  return Object.assign(run, {
    initialize: (nextNodes: RenderNode[]) => {
      nodes = nextNodes;
    },
  });
};

export const createGravityForce = (strength = 0.04): Force3D => {
  let nodes: RenderNode[] = [];

  const run = (alpha: number) => {
    const factor = strength * alpha;
    for (const node of nodes) {
      node.vx = (node.vx ?? 0) - (node.x ?? 0) * factor;
      node.vy = (node.vy ?? 0) - (node.y ?? 0) * factor;
      node.vz = (node.vz ?? 0) - (node.z ?? 0) * factor;
    }
  };

  return Object.assign(run, {
    initialize: (nextNodes: RenderNode[]) => {
      nodes = nextNodes;
    },
  });
};
