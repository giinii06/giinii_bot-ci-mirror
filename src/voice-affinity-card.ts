import { readFileSync } from "node:fs";
import { createCanvas, GlobalFonts, type CanvasGradient, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { LatheGeometry, OrthographicCamera, Vector2, Vector3 } from "three";

GlobalFonts.register(readFileSync(new URL("./assets/BMDoHyeon-Regular.ttf", import.meta.url)), "BM DoHyeon");

export type VoiceAffinityEntry = { name: string; username: string; sharedMs: number; avatar?: Image };
export type VoiceCardMode = "affinity" | "volume" | "chat" | "activity";

const WIDTH = 1600;
const SCALE = 1.5;
const MARGIN = 34;
const ROW_HEIGHT = 70;
export const PAGE_SIZE = 7;
const INK = "#252a43";
const MUTED = "#535c78";

const formatDuration = (milliseconds: number) => {
  if (milliseconds <= 0) return "0분";
  const minutes = Math.floor(milliseconds / 60_000);
  if (!minutes) return "1분 미만";
  return `${Math.floor(minutes / 60).toLocaleString("ko-KR")}시간 ${minutes % 60}분`;
};

const MODES = {
  affinity: { title: "음성 친밀도", metric: "함께 있었던 시간", format: formatDuration },
  volume: { title: "통화량", metric: "통화 시간", format: formatDuration },
  chat: {
    title: "채팅량", metric: "메시지 수",
    format: (count: number) => `${Math.round(count).toLocaleString("ko-KR")}개`,
  },
  activity: {
    title: "종합 활동량", metric: "활동 점수",
    format: (points: number) => `${Math.round(points).toLocaleString("ko-KR")}점`,
  },
} satisfies Record<VoiceCardMode, { title: string; metric: string; format: (value: number) => string }>;

const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

const label = (
  ctx: SKRSContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  width: number,
  align: CanvasTextAlign = "left",
  color = INK,
) => {
  ctx.font = `${size}px "BM DoHyeon", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (ctx.measureText(value).width > width) {
    let shortened = "";
    for (const { segment } of segmenter.segment(value)) {
      if (ctx.measureText(shortened + segment + "…").width > width) break;
      shortened += segment;
    }
    value = shortened + "…";
  }
  ctx.fillText(value, x, y);
};

const rounded = (
  ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number,
  fill: string | CanvasGradient, border?: string,
) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
};

const drawShadow = (
  ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number,
  spread: number, offset: number,
) => {
  // Layered fills keep full-width card shadows cheap on the CPU canvas.
  for (let layer = 8; layer > 0; layer--) {
    const expansion = spread * layer / 8;
    const fill = layer > 4 ? "#74739d03" : "#74739d07";
    rounded(ctx, x - expansion, y + offset - expansion, width + expansion * 2, height + expansion * 2, radius + expansion, fill);
  }
};

const drawAvatar = (ctx: SKRSContext2D, entry: VoiceAffinityEntry, x: number, y: number, size: number) => {
  const fill = ctx.createLinearGradient(x, y, x + size, y + size);
  fill.addColorStop(0, "#b8bdeb");
  fill.addColorStop(1, "#7d84bc");
  rounded(ctx, x, y, size, size, size * 0.28, fill);
  if (entry.avatar) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(entry.avatar, x, y, size, size);
    ctx.restore();
  } else {
    const initial = [...segmenter.segment(entry.name)][0]?.segment ?? "?";
    label(ctx, initial, x + size / 2, y + size / 2, size * 0.43, size, "center", "#ffffff");
  }
  ctx.strokeStyle = "#ffffffbd";
  ctx.lineWidth = size > 80 ? 3 : 1.5;
  ctx.stroke();
};

const PODIUM = [
  { x: 1014, radius: 167, height: 94, avatar: 115, body: ["#dec392", "#f5e1b5", "#dfc18f"], top: "#fff1d3", rank: "#866844" },
  { x: 720, radius: 129, height: 68, avatar: 92, body: ["#b2bbd9", "#dce2f4", "#bbc4df"], top: "#edf0fc", rank: "#5b6583" },
  { x: 1308, radius: 129, height: 64, avatar: 92, body: ["#dcb4c0", "#f4d8e0", "#dcb6c3"], top: "#fce9ed", rank: "#886072" },
];

const SEGMENTS = 64;
const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 3000);
camera.position.set(0, 425, 1800);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();

type ScreenPoint = { x: number; y: number };

const silhouette = (points: ScreenPoint[]) => {
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  const edge = (ordered: ScreenPoint[]) => {
    const result: ScreenPoint[] = [];
    for (const point of ordered) {
      while (result.length > 1) {
        const a = result[result.length - 2]!;
        const b = result[result.length - 1]!;
        if ((b.x - a.x) * (point.y - a.y) > (b.y - a.y) * (point.x - a.x)) break;
        result.pop();
      }
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...edge(sorted), ...edge(sorted.reverse())];
};

const drawPedestal = (ctx: SKRSContext2D, pedestal: typeof PODIUM[number], rank: number, floor: number) => {
  const { x, radius, height, body, top } = pedestal;
  const bevel = 8;
  const profile = [];
  for (let step = 0; step <= 8; step++) {
    const angle = step * Math.PI / 16;
    profile.push(new Vector2(radius - bevel + bevel * Math.sin(angle), bevel - bevel * Math.cos(angle)));
  }
  for (let step = 0; step <= 8; step++) {
    const angle = step * Math.PI / 16;
    profile.push(new Vector2(radius - bevel + bevel * Math.cos(angle), height - bevel + bevel * Math.sin(angle)));
  }

  const geometry = new LatheGeometry(profile, SEGMENTS);
  const positions = geometry.getAttribute("position");
  const point = new Vector3();
  const base = floor - radius * 0.215;
  const rings = profile.map((_, ring) => Array.from({ length: SEGMENTS }, (_, segment) => {
    point.fromBufferAttribute(positions, segment * profile.length + ring).project(camera);
    return { x: x + point.x, y: base - point.y };
  }));
  geometry.dispose();
  const bottom = rings[0]!;
  const cap = rings.at(-1)!;

  ctx.save();
  ctx.translate(x + 8, floor + 1);
  ctx.scale(radius * 1.18, 19);
  const contact = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  contact.addColorStop(0, "#51496f87");
  contact.addColorStop(0.62, "#51496f47");
  contact.addColorStop(1, "#51496f00");
  ctx.fillStyle = contact;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();

  const trace = (vertex: ScreenPoint) => ctx.lineTo(vertex.x, vertex.y);
  ctx.beginPath();
  silhouette(rings.flat()).forEach(trace);
  ctx.closePath();
  const side = ctx.createLinearGradient(x - radius, 0, x + radius, 0);
  side.addColorStop(0, body[0]!);
  side.addColorStop(0.37, body[1]!);
  side.addColorStop(1, body[2]!);
  ctx.fillStyle = side;
  ctx.fill();
  const glaze = ctx.createLinearGradient(0, cap[SEGMENTS / 2]!.y, 0, bottom[0]!.y);
  glaze.addColorStop(0, "#ffffff42");
  glaze.addColorStop(0.52, "#ffffff0d");
  glaze.addColorStop(0.8, "#55476412");
  glaze.addColorStop(1, "#5547643d");
  ctx.fillStyle = glaze;
  ctx.fill();

  ctx.beginPath();
  cap.forEach(trace);
  ctx.closePath();
  const surface = ctx.createLinearGradient(0, cap[SEGMENTS / 2]!.y, 0, cap[0]!.y);
  surface.addColorStop(0, "#fffdf9");
  surface.addColorStop(1, top);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.strokeStyle = "#ffffff91";
  ctx.lineWidth = 1;
  ctx.stroke();
  label(ctx, String(rank), x, floor - (rank === 1 ? 43 : 29), rank === 1 ? 52 : 39, radius, "center", pedestal.rank);
};

const drawPodium = (ctx: SKRSContext2D, entries: VoiceAffinityEntry[], format: (value: number) => string) => {
  for (const index of [1, 2, 0]) {
    const entry = entries[index];
    if (!entry) continue;
    const pedestal = PODIUM[index]!;
    const floor = index === 0 ? 411 : 404;
    drawPedestal(ctx, pedestal, index + 1, floor);
    const { x, avatar, radius, height } = pedestal;
    const pillTop = floor - radius * 0.215 - height - 53;
    const avatarTop = pillTop - 74 - avatar;
    drawShadow(ctx, x - avatar / 2, avatarTop, avatar, avatar, avatar * 0.28, 6, 4);
    drawAvatar(ctx, entry, x - avatar / 2, avatarTop, avatar);
    label(ctx, entry.name, x, pillTop - 50, index === 0 ? 36 : 30, radius * 1.86, "center");
    label(ctx, `@${entry.username}`, x, pillTop - 23, 21, radius * 1.86, "center", MUTED);
    rounded(ctx, x - 104, pillTop, 208, 40, 20, "#fafaff", "#e0e1f0");
    label(ctx, format(entry.sharedMs), x, pillTop + 21, 25, 192, "center");
  }
};

const drawRow = (
  ctx: SKRSContext2D, entry: VoiceAffinityEntry, rank: number, y: number,
  ratio: number, format: (value: number) => string,
) => {
  drawShadow(ctx, 58, y, 1484, 65, 20, 4, 3);
  rounded(ctx, 58, y, 1484, 65, 20, "#faf9ff", "#ffffff");
  rounded(ctx, 72, y + 11, 72, 43, 18, "#eae8f7");
  label(ctx, String(rank).padStart(2, "0"), 108, y + 34, 28, 64, "center", MUTED);
  drawAvatar(ctx, entry, 182, y + 5, 55);
  label(ctx, entry.name, 256, y + 21, 28, 220);
  label(ctx, `@${entry.username}`, 256, y + 47, 19, 220, "left", MUTED);
  rounded(ctx, 497, y + 23, 744, 19, 9.5, "#e2e1f2");
  if (ratio > 0) {
    const barWidth = 744 * Math.min(ratio, 1);
    const gradient = ctx.createLinearGradient(497, 0, 497 + barWidth, 0);
    gradient.addColorStop(0, "#a5baf3");
    gradient.addColorStop(1, "#748cdc");
    rounded(ctx, 497, y + 23, barWidth, 19, Math.min(9.5, barWidth / 2), gradient);
  }
  rounded(ctx, 1283, y + 11, 245, 43, 22, "#eae8f7");
  label(ctx, format(entry.sharedMs), 1405, y + 34, 26, 226, "center");
};

export const renderVoiceAffinity = async (
  targetName: string,
  entries: VoiceAffinityEntry[],
  startRank = 1,
  totalEntries = entries.length,
  mode: VoiceCardMode = "affinity",
  rankingMax = entries[0]?.sharedMs ?? 1,
) => {
  const spec = MODES[mode];
  const visible = entries.slice(0, PAGE_SIZE);
  const podium = startRank === 1 ? visible.slice(0, 3) : [];
  const rows = visible.slice(podium.length);
  const panelTop = podium.length ? 430 : 122;
  const panelHeight = 135 + rows.length * ROW_HEIGHT;
  const showPanel = rows.length > 0 || podium.length === 0;
  const height = (showPanel ? panelTop + panelHeight : panelTop) + MARGIN;
  const canvas = createCanvas(WIDTH * SCALE, Math.round(height * SCALE));
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  const background = ctx.createLinearGradient(0, 0, WIDTH * 0.7, height);
  background.addColorStop(0, "#f5f4ff");
  background.addColorStop(0.54, "#ebedfc");
  background.addColorStop(1, "#f5eaf5");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);

  const subject = mode === "affinity" ? `${targetName}님의` : targetName;
  const range = startRank > 1 ? `${startRank}–${startRank + visible.length - 1}위` : `TOP ${totalEntries}`;
  const title = totalEntries > 0 ? `${spec.title} ${range}` : spec.title;
  if (podium.length) {
    label(ctx, subject, 66, 117, 52, 498);
    label(ctx, title, 66, 174, 52, 498);
    drawPodium(ctx, podium, spec.format);
  } else {
    label(ctx, `${subject} ${title}`, 64, 68, 50, WIDTH - 128);
  }

  if (showPanel) {
    drawShadow(ctx, MARGIN, panelTop, WIDTH - MARGIN * 2, panelHeight, 29, 16, 10);
    rounded(ctx, MARGIN, panelTop, WIDTH - MARGIN * 2, panelHeight, 29, "#f6f4fc", "#ffffff");

    if (rows.length) {
      [11, 22, 34, 22, 11].forEach((size, index) =>
        rounded(ctx, 72 + index * 8, panelTop + 44 - size / 2, 5, size, 2.5, "#959ebc"),
      );
      label(ctx, `${spec.title} 랭킹`, 128, panelTop + 44, 30, 440);
      label(ctx, "순위", 108, panelTop + 104, 20, 64, "center", MUTED);
      label(ctx, "멤버", 224, panelTop + 104, 20, 240, "left", MUTED);
      label(ctx, spec.metric, 1405, panelTop + 104, 20, 226, "center", MUTED);
      rows.forEach((entry, index) => drawRow(
        ctx, entry, startRank + podium.length + index, panelTop + 120 + index * ROW_HEIGHT,
        entry.sharedMs / Math.max(rankingMax, 1), spec.format,
      ));
    } else {
      label(ctx, "아직 기록이 없습니다", WIDTH / 2, panelTop + panelHeight / 2, 30, WIDTH - 128, "center", MUTED);
    }
  }

  return canvas.encode("png");
};

export const rankingCards = async (
  title: string,
  entries: VoiceAffinityEntry[],
  mode: VoiceCardMode,
  name: string,
) => Promise.all(Array.from({ length: Math.ceil(entries.length / PAGE_SIZE) }, async (_, page) => ({
  name,
  attachment: await renderVoiceAffinity(
    title, entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    page * PAGE_SIZE + 1, entries.length, mode, entries[0]?.sharedMs,
  ),
})));
