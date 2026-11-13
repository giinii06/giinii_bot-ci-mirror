import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";

GlobalFonts.register(readFileSync(new URL("./assets/BMDoHyeon-Regular.ttf", import.meta.url)), "BM DoHyeon");

export type VoiceGraphMember = { userId: string; name: string; avatarUrl: string | null; voiceMs: number };
export type VoiceGraphPair = { source: string; target: string; sharedMs: number };
type VoiceGraphEdge = VoiceGraphPair & { kind: "mutual" | "one-sided" | "other" };

const GROUP_COLORS = ["#7c6bd0", "#229b90", "#d88c49", "#568fce", "#c76c9b", "#7e9851", "#b29b38", "#be6262", "#4e9fae", "#938174"];

const voiceCommunities = (ids: string[], pairs: VoiceGraphPair[]) => {
  const groups = ids.map((userId) => new Set([userId]));
  const degrees = new Map(ids.map((id) => [id, 0]));
  const total = pairs.reduce((sum, pair) => sum + pair.sharedMs, 0);
  for (const pair of pairs) {
    degrees.set(pair.source, (degrees.get(pair.source) ?? 0) + pair.sharedMs);
    degrees.set(pair.target, (degrees.get(pair.target) ?? 0) + pair.sharedMs);
  }
  while (total > 0) {
    let best: { a: number; b: number; gain: number } | null = null;
    for (const [a, first] of groups.entries()) {
      for (let b = a + 1; b < groups.length; b++) {
        const second = groups[b]!;
        const between = pairs.reduce((sum, pair) => sum + (
          first.has(pair.source) && second.has(pair.target) || first.has(pair.target) && second.has(pair.source)
            ? pair.sharedMs : 0), 0);
        const degreeA = [...first].reduce((sum, id) => sum + (degrees.get(id) ?? 0), 0);
        const degreeB = [...second].reduce((sum, id) => sum + (degrees.get(id) ?? 0), 0);
        const gain = between / total - degreeA * degreeB / (2 * total * total);
        if (gain > 1e-12 && (!best || gain > best.gain)) best = { a, b, gain };
      }
    }
    if (!best) break;
    for (const id of groups[best.b]!) groups[best.a]!.add(id);
    groups.splice(best.b, 1);
  }
  return groups.filter((group) => group.size > 1).map((group) => [...group]);
};

const WIDTH = 1920;
const HEIGHT = 1080;
const RADIUS = 60;
const SPACING = 196;
const BOUNDS = { left: 136, right: 1784, top: 242, bottom: 922 };

export const buildVoiceGraph = (members: VoiceGraphMember[], pairs: VoiceGraphPair[]) => {
  const selected = [...members].sort((a, b) => b.voiceMs - a.voiceMs || a.userId.localeCompare(b.userId)).slice(0, 20);
  const ids = new Set(selected.map((member) => member.userId));
  const unique = new Map<string, VoiceGraphPair>();
  for (const pair of pairs) {
    if (!ids.has(pair.source) || !ids.has(pair.target) || pair.source === pair.target || !(pair.sharedMs > 0)) continue;
    const [source, target] = [pair.source, pair.target].sort();
    if (source === undefined || target === undefined) continue;
    const key = `${source}:${target}`;
    const previous = unique.get(key);
    if (!previous || previous.sharedMs < pair.sharedMs) unique.set(key, { source, target, sharedMs: pair.sharedMs });
  }
  const ranked = [...unique.values()].sort((a, b) => b.sharedMs - a.sharedMs || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const favorites = new Map(selected.map(({ userId }) => [userId, new Set(ranked
    .filter(({ source, target }) => source === userId || target === userId)
    .slice(0, 7).map(({ source, target }) => source === userId ? target : source))]));
  const topThree = new Map(selected.map(({ userId }) => [userId, new Set(ranked
    .filter(({ source, target }) => source === userId || target === userId)
    .slice(0, 3).map(({ source, target }) => source === userId ? target : source))]));
  const edges: VoiceGraphEdge[] = ranked
    .filter(({ source, target }) => favorites.get(source)?.has(target) && favorites.get(target)?.has(source))
    .map((pair) => {
      const forward = topThree.get(pair.source)?.has(pair.target);
      const reverse = topThree.get(pair.target)?.has(pair.source);
      return { ...pair, kind: forward && reverse ? "mutual" : forward || reverse ? "one-sided" : "other" };
    });
  const groups = voiceCommunities([...ids], ranked);
  const communities = new Map(groups.flatMap((group, index) => group.map((id) => [id, index] satisfies [string, number])));
  const neighborCounts = new Map(selected.map(({ userId }) => [userId, 0]));
  const adjacent = new Set<string>();
  for (const pair of ranked) {
    if (!topThree.get(pair.source)?.has(pair.target) && !topThree.get(pair.target)?.has(pair.source)) continue;
    const sourceCount = neighborCounts.get(pair.source) ?? 0;
    const targetCount = neighborCounts.get(pair.target) ?? 0;
    if (sourceCount >= 3 || targetCount >= 3) continue;
    adjacent.add(`${pair.source}:${pair.target}`);
    neighborCounts.set(pair.source, sourceCount + 1);
    neighborCounts.set(pair.target, targetCount + 1);
  }
  const nodes = selected.map((member, index) => ({ ...member, community: communities.get(member.userId) ?? null,
    x: WIDTH / 2 + 740 * Math.sqrt((index + 0.5) / selected.length) * Math.cos(index * 2.399963),
    y: 580 + 310 * Math.sqrt((index + 0.5) / selected.length) * Math.sin(index * 2.399963),
  }));
  const maximum = Math.max(...ranked.map(({ sharedMs }) => sharedMs), 1);
  const sharedTimes = new Map(ranked.map((pair) => [`${pair.source}:${pair.target}`, pair.sharedMs]));
  for (let iteration = 0; iteration < 900; iteration++) {
    const movement = new Map(nodes.map((node) => [node, { x: (WIDTH / 2 - node.x) * 0.003, y: (580 - node.y) * 0.012 }]));
    for (const [index, a] of nodes.entries()) {
      for (const b of nodes.slice(index + 1)) {
        const key = [a.userId, b.userId].sort().join(":");
        const strength = (sharedTimes.get(key) ?? 0) / maximum;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;
        const attraction = adjacent.has(key) ? 0.5 * strength : 0.025 * strength;
        const force = (distance - SPACING) * attraction - 5000 / distance ** 1.3;
        const am = movement.get(a);
        const bm = movement.get(b);
        if (am && bm) {
          am.x += dx / distance * force;
          am.y += dy / distance * force;
          bm.x -= dx / distance * force;
          bm.y -= dy / distance * force;
        }
      }
    }
    for (const node of nodes) {
      const delta = movement.get(node);
      if (delta && iteration < 700) {
        node.x += Math.max(-8, Math.min(8, delta.x));
        node.y += Math.max(-8, Math.min(8, delta.y));
      }
    }
    if (iteration === 700 && nodes.length) {
      const minX = Math.min(...nodes.map((node) => node.x));
      const maxX = Math.max(...nodes.map((node) => node.x));
      const minY = Math.min(...nodes.map((node) => node.y));
      const maxY = Math.max(...nodes.map((node) => node.y));
      const scale = Math.min(1, (BOUNDS.right - BOUNDS.left) / (maxX - minX || 1), (BOUNDS.bottom - BOUNDS.top) / (maxY - minY || 1));
      for (const node of nodes) {
        node.x = WIDTH / 2 + (node.x - (minX + maxX) / 2) * scale;
        node.y = (BOUNDS.top + BOUNDS.bottom) / 2 + (node.y - (minY + maxY) / 2) * scale;
      }
    }
    for (let pass = 0; pass < 5; pass++) {
      for (const [index, a] of nodes.entries()) {
        for (const b of nodes.slice(index + 1)) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 1;
          const minimum = adjacent.has([a.userId, b.userId].sort().join(":")) ? SPACING : 260;
          if (distance >= minimum) continue;
          const push = (minimum - distance) / 2;
          const ux = dx / distance || 1;
          const uy = dy / distance;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
      for (const node of nodes) {
        if (iteration >= 700) {
          node.x = Math.max(BOUNDS.left, Math.min(BOUNDS.right, node.x));
          node.y = Math.max(BOUNDS.top, Math.min(BOUNDS.bottom, node.y));
        }
      }
    }
  }
  if (nodes.length) {
    const offsetX = WIDTH / 2 - (Math.min(...nodes.map((node) => node.x)) + Math.max(...nodes.map((node) => node.x))) / 2;
    const offsetY = (BOUNDS.top + BOUNDS.bottom) / 2 - (Math.min(...nodes.map((node) => node.y)) + Math.max(...nodes.map((node) => node.y))) / 2;
    for (const node of nodes) {
      node.x += offsetX;
      node.y += offsetY;
    }
  }
  return { nodes, edges, groups };
};

export const renderVoiceAffinityGraph = async (graph: ReturnType<typeof buildVoiceGraph>): Promise<Buffer> => {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eaf0fc";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.shadowColor = "#b4c4e04d";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#f7f9ff";
  ctx.beginPath();
  ctx.roundRect(28, 26, WIDTH - 56, HEIGHT - 52, 58);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const glow = ctx.createRadialGradient(1000, 590, 30, 1000, 590, 770);
  glow.addColorStop(0, "#cfdefb90");
  glow.addColorStop(1, "#eff4ff00");
  ctx.fillStyle = glow;
  ctx.fillRect(40, 170, WIDTH - 80, HEIGHT - 210);
  ctx.fillStyle = "#111b2c";
  ctx.font = '58px "BM DoHyeon"';
  ctx.fillText("친밀도 그래프", 90, 126);
  const byId = new Map(graph.nodes.map((node) => [node.userId, node]));
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(40, 170, WIDTH - 80, HEIGHT - 210, 40);
  ctx.clip();
  for (const [index, group] of graph.groups.entries()) {
    const nodes = group.flatMap((id) => { const node = byId.get(id); return node ? [node] : []; });
    ctx.strokeStyle = ctx.fillStyle = GROUP_COLORS[index % GROUP_COLORS.length]!;
    ctx.globalAlpha = 0.065;
    ctx.lineWidth = 208;
    ctx.lineCap = "round";
    const connected = nodes.slice(0, 1);
    const remaining = nodes.slice(1);
    while (remaining.length) {
      let nearest: { from: typeof nodes[number]; to: typeof nodes[number]; distance: number } | null = null;
      for (const from of connected) for (const to of remaining) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (!nearest || distance < nearest.distance) nearest = { from, to, distance };
      }
      if (!nearest) break;
      if (nearest.distance < 370) {
        ctx.beginPath();
        ctx.moveTo(nearest.from.x, nearest.from.y + 14);
        ctx.lineTo(nearest.to.x, nearest.to.y + 14);
        ctx.stroke();
      }
      connected.push(nearest.to);
      remaining.splice(remaining.indexOf(nearest.to), 1);
    }
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y + 14, 104, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  const maximum = Math.max(...graph.edges.map(({ sharedMs }) => sharedMs), 1);
  ctx.lineCap = "round";
  const tiers = { mutual: { width: 6, opacity: 0.94 }, "one-sided": { width: 3, opacity: 0.48 }, other: { width: 1.2, opacity: 0.10 } };
  for (const edge of [...graph.edges].sort((a, b) => tiers[a.kind].width - tiers[b.kind].width || a.sharedMs - b.sharedMs)) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;
    const tier = tiers[edge.kind];
    ctx.globalAlpha = tier.opacity;
    ctx.strokeStyle = a.community !== null && a.community === b.community
      ? GROUP_COLORS[a.community % GROUP_COLORS.length]! : "#376caf";
    ctx.lineWidth = tier.width + (edge.kind === "other" ? 0 : Math.sqrt(edge.sharedMs / maximum) * 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2 - (b.y - a.y) * 0.07, (a.y + b.y) / 2 + (b.x - a.x) * 0.07, b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = '20px "BM DoHyeon"';
  ctx.fillStyle = "#62728a";
  ctx.textBaseline = "middle";
  for (const [index, [kind, label]] of ([['mutual', '서로 TOP 3'], ['one-sided', '한쪽 TOP 3'], ['other', '그 외']] satisfies [keyof typeof tiers, string][]).entries()) {
    const x = 1290 + index * 180;
    ctx.globalAlpha = tiers[kind].opacity;
    ctx.strokeStyle = "#376caf";
    ctx.lineWidth = tiers[kind].width;
    ctx.beginPath();
    ctx.moveTo(x, 110);
    ctx.lineTo(x + 30, 110);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(label, x + 40, 110);
  }
  const avatars = await Promise.all(graph.nodes.map(async ({ avatarUrl }) => {
    if (!avatarUrl) return null;
    try {
      const response = await fetch(avatarUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      return await loadImage(Buffer.from(await response.arrayBuffer()));
    } catch { return null; }
  }));
  for (const [index, node] of graph.nodes.entries()) {
    ctx.save();
    ctx.shadowColor = "#7993bd50";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = node.community === null ? "#ffffff" : GROUP_COLORS[node.community % GROUP_COLORS.length]!;
    ctx.beginPath();
    ctx.arc(node.x, node.y, RADIUS + 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(node.x, node.y, RADIUS + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.beginPath();
    ctx.arc(node.x, node.y, RADIUS, 0, Math.PI * 2);
    ctx.clip();
    const avatar = avatars[index];
    if (avatar) {
      const side = Math.min(avatar.width, avatar.height);
      ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, node.x - RADIUS, node.y - RADIUS, RADIUS * 2, RADIUS * 2);
    } else {
      ctx.fillStyle = `hsl(${210 + index * 13 % 65}, 55%, 85%)`;
      ctx.fillRect(node.x - RADIUS, node.y - RADIUS, RADIUS * 2, RADIUS * 2);
      ctx.fillStyle = "#47618d";
      ctx.font = '42px "BM DoHyeon"';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Array.from(node.name).slice(0, 2).join(""), node.x, node.y);
    }
    ctx.restore();
    ctx.shadowColor = "#7993bd35";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(node.x - 84, node.y + 43, 168, 44, 22);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.font = '26px "BM DoHyeon"';
    let label = node.name;
    if (ctx.measureText(label).width > 140) {
      const letters = Array.from(label);
      while (letters.length && ctx.measureText(`${letters.join("")}…`).width > 140) letters.pop();
      label = `${letters.join("")}…`;
    }
    ctx.fillStyle = "#172236";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, node.x, node.y + 65);
  }
  return canvas.toBuffer("image/png");
};
