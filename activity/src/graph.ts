import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";
import { COMMUNITY_COLORS, type GraphNode, type GraphSnapshot } from "../../src/voice-graph-contract.js";
import type { AvatarSource } from "./api.js";
import { escapeHtml, haloTexture, initialsOf, loadImage, orbTexture, ringTexture } from "./avatar-plate.js";
import {
  BASE_RADIUS,
  computeLinkWeights,
  computeNodeScales,
  createCollideForce,
  createGravityForce,
  linkDistanceFor,
  linkStrengthFor,
  type RenderLink,
  type RenderNode,
} from "./layout.js";
import { highlightFor, linkKey, type Selection } from "./selection.js";
import { formatDuration } from "./ui.js";

export type GraphView = {
  setSnapshot: (snapshot: GraphSnapshot, selection: Selection, avatars: AvatarSource) => void;
  applySelection: (selection: Selection) => void;
  dispose: () => void;
};

const SPACE_BG = "#050814";
const FIT_PADDING = 16;
const NEUTRAL_COLOR = "#8d9bb5";
const LINK_COLORS = { mutual: "#cfdcff", "one-sided": "#7d90b8", other: "#4b5a76" } as const;
const LINK_WIDTHS = { mutual: 1.2, "one-sided": 0.65, other: 0 } as const;
const LINK_OPACITY = 0.4;
const RING_COLORS = { focus: "#8ca6ff", first: "#8a7bff", second: "#35b3a4" } as const;
const STAR_COLORS = ["#dbe8ff", "#ffffff", "#a8bcff", "#ffe3bf", "#d8bfff"] as const;
const NEBULA_SPECS = [
  { pos: [-520, 260, -720], color: "#21387a", scale: 920, opacity: 0.16 },
  { pos: [620, -220, -680], color: "#432473", scale: 880, opacity: 0.14 },
  { pos: [-260, -480, 640], color: "#15495e", scale: 840, opacity: 0.13 },
  { pos: [480, 380, 620], color: "#2d1d59", scale: 820, opacity: 0.13 },
  { pos: [0, 620, -420], color: "#1c3c6b", scale: 780, opacity: 0.12 },
] as const;

type FitPhase = "tick1" | "tick2" | "initial_done" | "settled";

type VisualStateKey = "centered" | "active" | "dimmed";
type VisualStateStyle = {
  opacity: number;
  desaturate: number;
  glowBoost: number;
  haloOpacity: number;
  transparent: boolean;
  depthWrite: boolean;
  renderOrder: number;
};

const VISUAL_STATE: Record<VisualStateKey, VisualStateStyle> = {
  centered: {
    opacity: 1,
    desaturate: 0,
    glowBoost: 0.45,
    haloOpacity: 0.72,
    transparent: false,
    depthWrite: true,
    renderOrder: 1,
  },
  active: {
    opacity: 1,
    desaturate: 0,
    glowBoost: 0,
    haloOpacity: 0.45,
    transparent: false,
    depthWrite: true,
    renderOrder: 0,
  },
  dimmed: {
    opacity: 0.22,
    desaturate: 0.72,
    glowBoost: -0.5,
    haloOpacity: 0.06,
    transparent: true,
    depthWrite: false,
    renderOrder: 0,
  },
};

const ORB_VERTEX_SHADER = `
varying vec3 vViewNormal;
varying vec3 vViewDir;

void main() {
  vViewNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

const ORB_FRAGMENT_SHADER = `
uniform sampler2D uMap;
uniform vec3 uCommunityColor;
uniform float uOpacity;
uniform float uDesaturate;
uniform float uGlowBoost;

varying vec3 vViewNormal;
varying vec3 vViewDir;

void main() {
  vec3 V = normalize(vViewDir);
  vec3 refUp = abs(V.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(refUp, V));
  vec3 up = cross(V, right);

  vec3 N = normalize(vViewNormal);
  vec2 p = vec2(dot(N, right), dot(N, up));
  float nz = max(dot(N, V), 0.0);
  float r = length(p);

  vec2 avatarUv = clamp(p * (0.5 / 0.84) + 0.5, 0.0, 1.0);
  vec3 avatar = texture2D(uMap, avatarUv).rgb;
  float avatarMask = 1.0 - smoothstep(0.58, 0.86, r);

  vec3 coreBase = mix(uCommunityColor * 0.24, avatar, avatarMask);

  vec3 L = normalize(vec3(0.45, 0.7, 0.85));
  float diff = 0.78 + 0.22 * max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 32.0) * 0.26;
  float fresnel = pow(1.0 - nz, 2.2);

  vec3 rim = uCommunityColor * (1.15 + uGlowBoost) * fresnel;
  vec3 color = coreBase * diff + vec3(spec) + rim;

  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma), uDesaturate);

  gl_FragColor = vec4(color, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

type OrbUniforms = {
  uMap: { value: THREE.Texture };
  uCommunityColor: { value: THREE.Color };
  uOpacity: { value: number };
  uDesaturate: { value: number };
  uGlowBoost: { value: number };
};

type NodeVisual = {
  group: THREE.Group;
  sphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  halo: THREE.Sprite;
  ring: THREE.Sprite;
  uniforms: OrbUniforms;
  state: VisualStateKey;
};

const communityColorOf = (node: GraphNode): string =>
  node.community === null
    ? NEUTRAL_COLOR
    : COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]!;

const createSpaceBackdrop = (nebulaMap: THREE.Texture | null) => {
  const group = new THREE.Group();
  const starCount = 900;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const palette = STAR_COLORS.map((hex) => new THREE.Color(hex));

  let seed = 0x51a7f3;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let i = 0; i < starCount; i += 1) {
    const u = nextRand() * 2 - 1;
    const phi = nextRand() * Math.PI * 2;
    const radius = 440 + nextRand() * 720;
    const planar = Math.sqrt(1 - u * u);
    positions[i * 3] = radius * planar * Math.cos(phi);
    positions[i * 3 + 1] = radius * planar * Math.sin(phi);
    positions[i * 3 + 2] = radius * u;

    const tint = palette[Math.floor(nextRand() * palette.length)]!;
    const brightness = 0.45 + nextRand() * 0.55;
    colors[i * 3] = tint.r * brightness;
    colors[i * 3 + 1] = tint.g * brightness;
    colors[i * 3 + 2] = tint.b * brightness;
    sizes[i] = 1.6 + Math.pow(nextRand(), 2) * 3.4;
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  starGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

  const starMaterial = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float aSize;
      attribute vec3 aColor;
      varying vec3 vColor;
      void main() {
        vColor = aColor;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * (380.0 / max(1.0, -mvPos.z)), 1.3, 6.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float alpha = 1.0 - smoothstep(0.08, 0.5, d);
        if (alpha <= 0.01) discard;
        gl_FragColor = vec4(vColor, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.raycast = () => {};
  group.add(stars);

  const nebulaMaterials: THREE.SpriteMaterial[] = [];
  if (nebulaMap) {
    for (const spec of NEBULA_SPECS) {
      const material = new THREE.SpriteMaterial({
        map: nebulaMap,
        color: spec.color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      sprite.scale.set(spec.scale, spec.scale, 1);
      sprite.raycast = () => {};
      nebulaMaterials.push(material);
      group.add(sprite);
    }
  }

  return {
    group,
    dispose: () => {
      starGeometry.dispose();
      starMaterial.dispose();
      for (const material of nebulaMaterials) material.dispose();
      group.clear();
    },
  };
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
  let hoveredId: string | null = null;
  let generation = 0;
  let fitPhase: FitPhase = "tick1";
  let userMoved = false;

  const graph = new ForceGraph3D(container, { controlType: "orbit" }) as unknown as
    ForceGraph3DInstance<RenderNode, RenderLink>;

  const sphereGeometry = new THREE.SphereGeometry(BASE_RADIUS, 36, 24);
  const sharedHaloTexture = haloTexture();
  const spaceBackdrop = createSpaceBackdrop(sharedHaloTexture);
  graph.scene().add(spaceBackdrop.group);
  const fallbackMap = new THREE.DataTexture(new Uint8Array([14, 22, 42, 255]), 1, 1);
  fallbackMap.colorSpace = THREE.SRGBColorSpace;
  fallbackMap.needsUpdate = true;

  const ringTextures = {
    focus: ringTexture(RING_COLORS.focus),
    first: ringTexture(RING_COLORS.first),
    second: ringTexture(RING_COLORS.second),
  };

  const disposeNodeTexture = (texture: THREE.Texture) => {
    if (texture !== fallbackMap) texture.dispose();
  };

  const syncVisualStyle = (id: string, visual: NodeVisual) => {
    const style = VISUAL_STATE[visual.state];
    const hoverBoost = id === hoveredId && visual.state !== "dimmed" ? 0.45 : 0;
    visual.uniforms.uOpacity.value = style.opacity;
    visual.uniforms.uDesaturate.value = style.desaturate;
    visual.uniforms.uGlowBoost.value = style.glowBoost + hoverBoost;
    visual.sphere.material.transparent = style.transparent;
    visual.sphere.material.depthWrite = style.depthWrite;
    visual.sphere.renderOrder = style.renderOrder;
    visual.halo.material.opacity = Math.min(1, style.haloOpacity + (hoverBoost > 0 ? 0.18 : 0));
  };

  const buildVisual = (node: RenderNode): NodeVisual => {
    const fallback = initialsOf(node.name);
    const color = communityColorOf(node);
    const uniforms: OrbUniforms = {
      uMap: { value: orbTexture(null, fallback, color) ?? fallbackMap },
      uCommunityColor: { value: new THREE.Color(color) },
      uOpacity: { value: VISUAL_STATE.active.opacity },
      uDesaturate: { value: VISUAL_STATE.active.desaturate },
      uGlowBoost: { value: VISUAL_STATE.active.glowBoost },
    };
    const sphere = new THREE.Mesh(sphereGeometry, new THREE.ShaderMaterial({
      uniforms,
      vertexShader: ORB_VERTEX_SHADER,
      fragmentShader: ORB_FRAGMENT_SHADER,
      transparent: VISUAL_STATE.active.transparent,
      depthWrite: VISUAL_STATE.active.depthWrite,
    }));

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sharedHaloTexture,
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: VISUAL_STATE.active.haloOpacity,
      depthWrite: false,
      depthTest: true,
    }));
    halo.scale.set(BASE_RADIUS * 2.9, BASE_RADIUS * 2.9, 1);
    halo.raycast = () => {};

    const ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTextures.focus,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }));
    ring.scale.set(BASE_RADIUS * 2.5, BASE_RADIUS * 2.5, 1);
    ring.renderOrder = 3;
    ring.visible = false;
    ring.raycast = () => {};

    const group = new THREE.Group();
    group.add(halo, sphere, ring);
    group.scale.setScalar(node.scale);
    return { group, sphere, halo, ring, uniforms, state: "active" };
  };

  const applyAvatar = async (node: GraphNode, url: string | null, epoch: number) => {
    if (!url) return;
    const fallback = initialsOf(node.name);
    const color = communityColorOf(node);
    const texture = await loadImage(url).then((image) => orbTexture(image, fallback, color)).catch(() => null);
    if (epoch !== generation || !texture) {
      texture?.dispose();
      return;
    }
    const visual = visuals.get(node.id);
    if (!visual) {
      texture.dispose();
      return;
    }
    disposeNodeTexture(visual.uniforms.uMap.value);
    visual.uniforms.uMap.value = texture;
  };

  const disposeVisuals = () => {
    generation += 1;
    hoveredId = null;
    for (const visual of visuals.values()) {
      disposeNodeTexture(visual.uniforms.uMap.value);
      visual.sphere.material.dispose();
      visual.halo.material.dispose();
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
      visual.state = centered ? "centered" : active ? "active" : "dimmed";
      syncVisualStyle(id, visual);
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
    fitPhase = "tick1";
    userMoved = false;

    const scales = computeNodeScales(next.nodes);
    const weights = computeLinkWeights(next.links);
    const degrees = new Map<string, number>();
    for (const link of next.links) {
      degrees.set(link.source, (degrees.get(link.source) ?? 0) + 1);
      degrees.set(link.target, (degrees.get(link.target) ?? 0) + 1);
    }

    const nodes: RenderNode[] = next.nodes.map((node) => {
      const scale = scales.get(node.id) ?? 1;
      return { ...node, scale, radius: BASE_RADIUS * scale, degree: degrees.get(node.id) ?? 1 };
    });
    visuals = new Map(nodes.map((node) => [node.id, buildVisual(node)] as const));
    for (const node of next.nodes) {
      void nextAvatars.resolve(node.id).then((url) => applyAvatar(node, url, epoch));
    }
    const links: RenderLink[] = next.links.map((link, index) => ({
      ...link,
      sourceId: link.source,
      targetId: link.target,
      weight: weights[index] ?? 0,
    }));
    graph.graphData({ nodes, links });
    applySelection(nextSelection);
  };

  const endpointOf = (endpoint: string | RenderNode): RenderNode | null =>
    typeof endpoint === "object" ? endpoint : null;

  const linkForce = graph.d3Force("link");
  if (!linkForce || typeof linkForce.distance !== "function" || typeof linkForce.strength !== "function") {
    throw new Error("missing d3 link force");
  }
  linkForce.distance((link: RenderLink) => {
    const source = endpointOf(link.source);
    const target = endpointOf(link.target);
    return linkDistanceFor(source?.radius ?? BASE_RADIUS, target?.radius ?? BASE_RADIUS, link.weight);
  });
  linkForce.strength((link: RenderLink) => {
    const source = endpointOf(link.source);
    const target = endpointOf(link.target);
    return linkStrengthFor(link.weight, source?.degree ?? 1, target?.degree ?? 1);
  });
  const chargeForce = graph.d3Force("charge");
  if (!chargeForce || typeof chargeForce.strength !== "function" || typeof chargeForce.distanceMax !== "function") {
    throw new Error("missing d3 charge force");
  }
  chargeForce.strength((node: RenderNode) => -45 - 12 * node.radius);
  chargeForce.distanceMax(260);
  graph.d3Force("collide", createCollideForce());
  graph.d3Force("gravity", createGravityForce());

  graph
    .backgroundColor(SPACE_BG)
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
    .onNodeHover((node) => {
      const nextHover = node ? node.id : null;
      if (nextHover === hoveredId) return;
      const previousHover = hoveredId;
      hoveredId = nextHover;
      if (previousHover) {
        const previousVisual = visuals.get(previousHover);
        if (previousVisual) syncVisualStyle(previousHover, previousVisual);
      }
      if (nextHover) {
        const nextVisual = visuals.get(nextHover);
        if (nextVisual) syncVisualStyle(nextHover, nextVisual);
      }
    })
    .onNodeClick((node) => onSelect(node.id))
    .onBackgroundClick((event) => {
      if (event.detail >= 2) graph.zoomToFit(500, FIT_PADDING);
      else onSelect(null);
    })
    .enableNodeDrag(false)
    .warmupTicks(40)
    .cooldownTicks(200)
    .cooldownTime(6000)
    .d3AlphaDecay(0.03)
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

  graph.onEngineTick(() => {
    if (fitPhase === "tick1") {
      fitPhase = "tick2";
      return;
    }
    if (fitPhase === "tick2") {
      fitPhase = "initial_done";
      if (userMoved) return;
      graph.scene().updateMatrixWorld(true);
      graph.zoomToFit(0, FIT_PADDING);
    }
  });

  graph.onEngineStop(() => {
    if (fitPhase === "settled" || userMoved) return;
    fitPhase = "settled";
    graph.scene().updateMatrixWorld(true);
    graph.zoomToFit(450, FIT_PADDING);
  });

  rebuild(initial, initialSelection, avatars);
  graph.cameraPosition({ x: 0, y: 0, z: 160 }, undefined, 0);

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
      spaceBackdrop.dispose();
      sphereGeometry.dispose();
      sharedHaloTexture?.dispose();
      fallbackMap.dispose();
      for (const texture of Object.values(ringTextures)) texture?.dispose();
      graph._destructor();
      container.replaceChildren();
    },
  };
};
