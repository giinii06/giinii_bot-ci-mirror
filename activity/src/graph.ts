import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";
import { COMMUNITY_COLORS, type GraphLink, type GraphNode, type GraphSnapshot } from "../../src/voice-graph-contract.js";
import type { AvatarSource } from "./api.js";
import { escapeHtml, initialsOf, loadImage, plateTexture, ringTexture } from "./avatar-plate.js";
import { highlightFor, linkKey, type Selection } from "./selection.js";
import { formatDuration } from "./ui.js";

type RenderNode = GraphNode & { x?: number; y?: number; z?: number };
type RenderLink = GraphLink & {
  sourceId: string;
  targetId: string;
  source: string | RenderNode;
  target: string | RenderNode;
};

export type GraphView = {
  setSnapshot: (snapshot: GraphSnapshot, selection: Selection, avatars: AvatarSource) => void;
  applySelection: (selection: Selection) => void;
  dispose: () => void;
};

const NEUTRAL_COLOR = "#8d9bb5";
const LINK_COLORS = { mutual: "#cfdcff", "one-sided": "#7d90b8", other: "#4b5a76" } as const;
const LINK_WIDTHS = { mutual: 1.2, "one-sided": 0.65, other: 0 } as const;
const LINK_OPACITY = 0.4;
const NODE_RADIUS = 4;
const RING_COLORS = { focus: "#8ca6ff", first: "#8a7bff", second: "#35b3a4" } as const;

type NodeVisual = {
  group: THREE.Group;
  sphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
  sprite: THREE.Sprite;
  ring: THREE.Sprite;
};

export const mountGraph = (
  container: HTMLElement,
  initial: GraphSnapshot,
  initialSelection: Selection,
  onSelect: (userId: string | null) => void,
  avatars: AvatarSource,
): GraphView => {
  let snapshot = initial;
  let selection = initialSelection;
  let visuals = new Map<string, NodeVisual>();
  let generation = 0;
  let needsFit = true;
  let userMoved = false;

  const graph = new ForceGraph3D(container, { controlType: "orbit" }) as unknown as
    ForceGraph3DInstance<RenderNode, RenderLink>;

  const sphereGeometry = new THREE.SphereGeometry(NODE_RADIUS, 20, 14);
  const ringTextures = {
    focus: ringTexture(RING_COLORS.focus),
    first: ringTexture(RING_COLORS.first),
    second: ringTexture(RING_COLORS.second),
  };

  /** 첫 장면은 이니셜로 즉시 만들고, 도착한 아바타만 나중에 끼운다. */
  const buildVisual = (node: GraphNode): NodeVisual => {
    const fallback = initialsOf(node.name);
    const color = node.community === null
      ? NEUTRAL_COLOR
      : COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]!;
    const sphere = new THREE.Mesh(sphereGeometry, new THREE.MeshLambertMaterial({
      color,
      emissive: new THREE.Color(color).multiplyScalar(0.12),
      transparent: true,
      opacity: 1,
    }));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: plateTexture(null, fallback),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
    }));
    sprite.scale.set(NODE_RADIUS * 1.95, NODE_RADIUS * 1.95, 1);
    sprite.position.z = NODE_RADIUS + 0.35;
    sprite.renderOrder = 2;

    const ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTextures.focus,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }));
    ring.scale.set(NODE_RADIUS * 2.5, NODE_RADIUS * 2.5, 1);
    ring.position.z = NODE_RADIUS + 0.3;
    ring.renderOrder = 1;
    ring.visible = false;

    const group = new THREE.Group();
    group.add(sphere, sprite, ring);
    return { group, sphere, sprite, ring };
  };

  const applyAvatar = async (node: GraphNode, url: string | null, epoch: number) => {
    if (!url) return;
    const fallback = initialsOf(node.name);
    const texture = await loadImage(url).then((image) => plateTexture(image, fallback)).catch(() => null);
    if (epoch !== generation || !texture) {
      texture?.dispose();
      return;
    }
    const visual = visuals.get(node.id);
    if (!visual) {
      texture.dispose();
      return;
    }
    visual.sprite.material.map?.dispose();
    visual.sprite.material.map = texture;
    visual.sprite.material.needsUpdate = true;
  };

  const disposeVisuals = () => {
    generation += 1;
    for (const visual of visuals.values()) {
      visual.sphere.material.dispose();
      visual.sprite.material.map?.dispose();
      visual.sprite.material.dispose();
      visual.ring.material.dispose();
      visual.group.clear();
    }
    visuals.clear();
  };

  const applySelection = (next: Selection) => {
    selection = next;
    const highlight = highlightFor(snapshot, next);
    const focused = next.mode !== "all";
    const centers = new Set<string>();
    if (next.mode === "focus") centers.add(next.userId);
    if (next.mode === "compare") {
      centers.add(next.first);
      if (next.second) centers.add(next.second);
    }
    for (const [id, visual] of visuals) {
      const active = highlight.nodes.has(id);
      const centered = centers.has(id);
      visual.sphere.material.opacity = active ? 1 : 0.2;
      visual.sprite.material.opacity = active ? 1 : 0.14;
      visual.ring.visible = centered;
      if (centered) {
        const desiredRing = next.mode === "compare"
          ? (id === next.first ? ringTextures.first : ringTextures.second)
          : ringTextures.focus;
        if (visual.ring.material.map !== desiredRing) {
          visual.ring.material.map = desiredRing;
          visual.ring.material.needsUpdate = true;
        }
      }
    }
    graph.linkVisibility((link) => focused
      ? highlight.links.has(linkKey(link.sourceId, link.targetId))
      : link.visibleByDefault);
    graph.refresh();
  };

  const rebuild = (next: GraphSnapshot, nextSelection: Selection, nextAvatars: AvatarSource) => {
    disposeVisuals();
    const epoch = generation;
    snapshot = next;
    selection = nextSelection;
    needsFit = true;
    userMoved = false;
    const nodes: RenderNode[] = next.nodes.map((node) => ({ ...node }));
    visuals = new Map(next.nodes.map((node) => [node.id, buildVisual(node)] as const));
    for (const node of next.nodes) {
      void nextAvatars.resolve(node.id).then((url) => applyAvatar(node, url, epoch));
    }
    const links: RenderLink[] = next.links.map((link) => ({
      ...link,
      sourceId: link.source,
      targetId: link.target,
    }));
    graph.graphData({ nodes, links });
    applySelection(nextSelection);
  };

  graph
    .backgroundColor("#0b1020")
    .showNavInfo(false)
    .nodeLabel((node) => `<div class="tooltip"><strong>${escapeHtml(node.name)}</strong>`
      + `<span>${formatDuration(node.voiceMs)}</span></div>`)
    .linkLabel((link) => `<div class="tooltip"><span>${formatDuration(link.sharedMs)} 함께</span></div>`)
    .linkColor((link) => LINK_COLORS[link.kind])
    .linkWidth((link) => LINK_WIDTHS[link.kind])
    .linkOpacity(LINK_OPACITY)
    .linkVisibility((link) => link.visibleByDefault)
    .linkDirectionalParticles(0)
    .nodeThreeObject((node) => visuals.get(node.id)?.group ?? new THREE.Object3D())
    .onNodeClick((node) => onSelect(node.id))
    .onBackgroundClick((event) => {
      if (event.detail >= 2) graph.zoomToFit(500, 70);
      else onSelect(null);
    })
    .enableNodeDrag(false)
    .cooldownTicks(160)
    .cooldownTime(6000)
    .d3AlphaDecay(0.035)
    .d3VelocityDecay(0.4);

  const mobile = window.matchMedia("(max-width: 720px)").matches;
  graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));

  const resize = () => {
    graph.width(container.clientWidth || window.innerWidth);
    graph.height(container.clientHeight || window.innerHeight);
  };
  const onVisibility = () => {
    if (document.hidden) graph.pauseAnimation();
    else graph.resumeAnimation();
  };
  const markMoved = () => { userMoved = true; };
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);
  container.addEventListener("pointerdown", markMoved);
  container.addEventListener("wheel", markMoved, { passive: true });
  resize();

  graph.onEngineStop(() => {
    if (!needsFit || userMoved) return;
    needsFit = false;
    graph.zoomToFit(600, 70);
  });

  rebuild(initial, initialSelection, avatars);
  graph.cameraPosition({ x: 0, y: 0, z: 420 }, undefined, 0);

  return {
    setSnapshot: rebuild,
    applySelection,
    dispose: () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      container.removeEventListener("pointerdown", markMoved);
      container.removeEventListener("wheel", markMoved);
      graph.pauseAnimation();
      disposeVisuals();
      sphereGeometry.dispose();
      for (const texture of Object.values(ringTextures)) texture?.dispose();
      graph._destructor();
      container.replaceChildren();
    },
  };
};
