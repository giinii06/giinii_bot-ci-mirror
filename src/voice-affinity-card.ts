import { readFileSync } from "node:fs";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

GlobalFonts.register(readFileSync(new URL("./assets/BMDoHyeon-Regular.ttf", import.meta.url)), "BM DoHyeon");

export type VoiceAffinityEntry = { name: string; username: string; sharedMs: number };
export type VoiceCardMode = "affinity" | "volume" | "chat" | "activity";

const CANVAS = { width: 2400, height: 1350, margin: 64 };
const HEADER = { x: CANVAS.margin, y: CANVAS.margin, width: 2272, height: 248 };
const PANEL = { x: CANVAS.margin, y: HEADER.y + HEADER.height + 32, width: 2272 };
const SUMMARY = { first: { x: 1620, width: 340 }, second: { x: 1984, width: 312 }, y: 104, height: 168 };
const ROW_RECT = { x: PANEL.x + 36, width: PANEL.width - 72 };
const COLUMNS = { rank: 196, name: 236, nameWidth: 460, bar: 760, barWidth: 1080, value: 2264 };
const ROW = { height: 118, gap: 10, top: PANEL.y + 108 };
const PANEL_TEXT = { column: PANEL.y + 64, rule: PANEL.y + 86 };
const EMPTY = { height: 208, padding: 24 };

const COLORS = {
  canvas: "#0A0E17",
  canvasTop: "#121A2B",
  panel: "#141C2E",
  row: "#182338",
  rowAlt: "#1D2A42",
  rowLead: "#233450",
  inset: "#0D1320",
  border: "#253148",
  text: "#F2F5FA",
  muted: "#94A3BC",
  subtle: "#64748F"
} as const;

const HEADER_TEXT = { eyebrow: 120, title: 212, subtitle: 272 };

const COLUMN_BLOCK = ROW.top - PANEL.y;
const BOTTOM_PAD = 40;

const panelHeightFor = (rowCount: number) =>
  rowCount === 0
    ? EMPTY.padding * 2 + EMPTY.height
    : COLUMN_BLOCK + rowCount * ROW.height - ROW.gap + BOTTOM_PAD;

const canvasHeightFor = (rowCount: number) => PANEL.y + panelHeightFor(rowCount) + CANVAS.margin;

const FONT = '"BM DoHyeon"';

const RADIUS = { card: 20, row: 12, capsule: 999, inset: 16 } as const;

type ModeSpec = {
  accent: string;
  accentSoft: string;
  overline: string;
  metric: string;
  subtitle: string;
  totalLabel: string;
  countLabel: string;
  title: (subject: string, total: number) => string;
  emptyTitle: (subject: string) => string;
  format: (value: number) => string;
};

const formatDuration = (milliseconds: number) => {
  if (milliseconds <= 0) return "0분";
  const minutes = Math.floor(milliseconds / 60_000);
  if (!minutes) return "1분 미만";
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
};

const formatCount = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}개`;
const formatPoints = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}점`;
const formatPeople = (value: number) => `${value.toLocaleString("ko-KR")}명`;

const MODES: Record<VoiceCardMode, ModeSpec> = {
  affinity: {
    accent: "#6FE3C8",
    accentSoft: "#2E5F5A",
    overline: "VOICE AFFINITY",
    metric: "함께 있던 시간",
    subtitle: "같은 음성 채널에 함께 있었던 시간",
    totalLabel: "전체 함께한 시간",
    countLabel: "함께한 인원",
    title: (subject, total) => `${subject}님의 음성 친밀도 TOP ${total}`,
    emptyTitle: (subject) => `${subject}님의 음성 친밀도 기록 없음`,
    format: formatDuration
  },
  volume: {
    accent: "#7FC7F5",
    accentSoft: "#2C5470",
    overline: "GIINII BOARD · VOICE",
    metric: "통화량",
    subtitle: "음성 채널에 머문 시간",
    totalLabel: "전체 통화량",
    countLabel: "기록된 인원",
    title: (_subject, total) => `전체 통화량 TOP ${total}`,
    emptyTitle: () => "전체 통화량 기록 없음",
    format: formatDuration
  },
  chat: {
    accent: "#F2C86A",
    accentSoft: "#6B5426",
    overline: "GIINII BOARD · CHAT",
    metric: "메시지 수",
    subtitle: "보낸 메시지 수",
    totalLabel: "전체 메시지",
    countLabel: "기록된 인원",
    title: (subject, total) => `${subject} 채팅량 TOP ${total}`,
    emptyTitle: (subject) => `${subject} 채팅량 기록 없음`,
    format: formatCount
  },
  activity: {
    accent: "#C3AEF7",
    accentSoft: "#4E4380",
    overline: "GIINII BOARD · ACTIVITY",
    metric: "활동 점수",
    subtitle: "메시지 1개 + 통화 1분 = 1점",
    totalLabel: "전체 활동 점수",
    countLabel: "기록된 인원",
    title: (subject, total) => `${subject} 종합 활동량 TOP ${total}`,
    emptyTitle: (subject) => `${subject} 종합 활동량 기록 없음`,
    format: formatPoints
  }
};

const roundedRect = (ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
};

const fillRounded = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string | CanvasGradient
) => {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
};

const strokeRounded = (ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number, color: string) => {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
};

const fitText = (ctx: SKRSContext2D, text: string, width: number) => {
  if (ctx.measureText(text).width <= width) return text;
  let shortened = text;
  while (shortened && ctx.measureText(`${shortened}…`).width > width) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
};

const formatCheckedAt = (milliseconds: number) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true
}).format(new Date(milliseconds));

const drawBackground = (ctx: SKRSContext2D, height: number) => {
  const gradient = ctx.createLinearGradient(0, 0, CANVAS.width, height);
  gradient.addColorStop(0, COLORS.canvasTop);
  gradient.addColorStop(1, COLORS.canvas);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS.width, height);
};

const drawSummaryBlock = (
  ctx: SKRSContext2D,
  box: { x: number; width: number },
  label: string,
  value: string,
  spec: ModeSpec
) => {
  fillRounded(ctx, box.x, SUMMARY.y, box.width, SUMMARY.height, RADIUS.inset, COLORS.inset);
  strokeRounded(ctx, box.x, SUMMARY.y, box.width, SUMMARY.height, RADIUS.inset, COLORS.border);
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.muted;
  ctx.font = `28px ${FONT}`;
  ctx.fillText(fitText(ctx, label, box.width - 48), box.x + 24, SUMMARY.y + 52);
  ctx.fillStyle = spec.accent;
  ctx.font = `48px ${FONT}`;
  ctx.fillText(fitText(ctx, value, box.width - 48), box.x + 24, SUMMARY.y + 126);
};

const drawHeader = (
  ctx: SKRSContext2D,
  title: string,
  checkedAt: number,
  spec: ModeSpec,
  totalValue: string,
  countValue: string
) => {
  fillRounded(ctx, HEADER.x, HEADER.y, HEADER.width, HEADER.height, RADIUS.card, COLORS.panel);
  strokeRounded(ctx, HEADER.x, HEADER.y, HEADER.width, HEADER.height, RADIUS.card, COLORS.border);

  ctx.textAlign = "left";
  ctx.fillStyle = spec.accent;
  ctx.font = `30px ${FONT}`;
  ctx.fillText(spec.overline, HEADER.x + 40, HEADER_TEXT.eyebrow);

  ctx.fillStyle = COLORS.text;
  ctx.font = `92px ${FONT}`;
  ctx.fillText(fitText(ctx, title, SUMMARY.first.x - HEADER.x - 88), HEADER.x + 40, HEADER_TEXT.title);

  ctx.fillStyle = COLORS.muted;
  ctx.font = `34px ${FONT}`;
  ctx.fillText(`${spec.subtitle} · ${formatCheckedAt(checkedAt)} 기준`, HEADER.x + 40, HEADER_TEXT.subtitle);

  drawSummaryBlock(ctx, SUMMARY.first, spec.totalLabel, totalValue, spec);
  drawSummaryBlock(ctx, SUMMARY.second, spec.countLabel, countValue, spec);
};

const drawColumnHeader = (ctx: SKRSContext2D, spec: ModeSpec) => {
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.subtle;
  ctx.font = `26px ${FONT}`;
  ctx.fillText("순위", COLUMNS.rank, PANEL_TEXT.column);
  ctx.textAlign = "left";
  ctx.fillText("멤버", COLUMNS.name, PANEL_TEXT.column);
  ctx.textAlign = "right";
  ctx.fillText(spec.metric, COLUMNS.value, PANEL_TEXT.column);

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ROW_RECT.x, PANEL_TEXT.rule);
  ctx.lineTo(ROW_RECT.x + ROW_RECT.width, PANEL_TEXT.rule);
  ctx.stroke();
};

const drawRow = (
  ctx: SKRSContext2D,
  entry: VoiceAffinityEntry,
  rank: number,
  top: number,
  height: number,
  ratio: number,
  spec: ModeSpec
) => {
  const surface = rank === 1 ? COLORS.rowLead : rank % 2 === 0 ? COLORS.rowAlt : COLORS.row;
  fillRounded(ctx, ROW_RECT.x, top, ROW_RECT.width, height, RADIUS.row, surface);

  const centerY = top + height / 2;
  ctx.textAlign = "right";
  ctx.fillStyle = rank === 1 ? COLORS.text : COLORS.subtle;
  ctx.font = `40px ${FONT}`;
  ctx.fillText(String(rank).padStart(2, "0"), COLUMNS.rank, centerY + 14);

  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `46px ${FONT}`;
  ctx.fillText(fitText(ctx, entry.name, COLUMNS.nameWidth), COLUMNS.name, centerY - 6);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `26px ${FONT}`;
  ctx.fillText(fitText(ctx, `@${entry.username}`, COLUMNS.nameWidth), COLUMNS.name, centerY + 34);

  const barHeight = Math.min(30, Math.max(18, height * 0.22));
  const barY = top + (height - barHeight) / 2;
  fillRounded(ctx, COLUMNS.bar, barY, COLUMNS.barWidth, barHeight, RADIUS.capsule, COLORS.inset);
  const gradient = ctx.createLinearGradient(COLUMNS.bar, 0, COLUMNS.bar + COLUMNS.barWidth, 0);
  gradient.addColorStop(0, spec.accent);
  gradient.addColorStop(1, spec.accentSoft);
  const filled = Math.max(barHeight, COLUMNS.barWidth * ratio);
  fillRounded(ctx, COLUMNS.bar, barY, filled, barHeight, RADIUS.capsule, gradient);

  ctx.textAlign = "right";
  ctx.fillStyle = rank === 1 ? spec.accent : COLORS.text;
  ctx.font = `44px ${FONT}`;
  ctx.fillText(spec.format(entry.sharedMs), COLUMNS.value, centerY + 16);
};

const drawEmptyState = (ctx: SKRSContext2D, panelHeight: number, spec: ModeSpec) => {
  const box = { x: PANEL.x + 120, width: PANEL.width - 240, height: EMPTY.height };
  const boxY = PANEL.y + (panelHeight - EMPTY.height) / 2;
  fillRounded(ctx, box.x, boxY, box.width, box.height, RADIUS.inset, COLORS.inset);
  strokeRounded(ctx, box.x, boxY, box.width, box.height, RADIUS.inset, COLORS.border);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.muted;
  ctx.font = `44px ${FONT}`;
  ctx.fillText("아직 기록이 없습니다", box.x + box.width / 2, boxY + 116);
  ctx.fillStyle = COLORS.subtle;
  ctx.font = `30px ${FONT}`;
  ctx.fillText(`${spec.metric} 기준 · 기록이 쌓이면 이곳에 순위가 표시됩니다`, box.x + box.width / 2, boxY + 164);
};

export const renderVoiceAffinity = (
  targetName: string,
  entries: VoiceAffinityEntry[],
  checkedAt: number,
  startRank = 1,
  totalEntries = entries.length,
  mode: VoiceCardMode = "affinity",
  totalDurationMs = entries.reduce((sum, entry) => sum + entry.sharedMs, 0)
) => {
  const spec = MODES[mode];
  const visibleEntries = entries.slice(0, 7);
  const isEmpty = totalEntries === 0;
  const title = isEmpty ? spec.emptyTitle(targetName) : spec.title(targetName, totalEntries);
  const panelHeight = panelHeightFor(visibleEntries.length);
  const height = canvasHeightFor(visibleEntries.length);

  const canvas = createCanvas(CANVAS.width, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, height);
  drawHeader(
    ctx,
    title,
    checkedAt,
    spec,
    isEmpty ? "—" : spec.format(totalDurationMs),
    formatPeople(totalEntries)
  );

  fillRounded(ctx, PANEL.x, PANEL.y, PANEL.width, panelHeight, RADIUS.card, COLORS.panel);
  strokeRounded(ctx, PANEL.x, PANEL.y, PANEL.width, panelHeight, RADIUS.card, COLORS.border);

  if (visibleEntries.length === 0) {
    drawEmptyState(ctx, panelHeight, spec);
    return canvas.toBuffer("image/png");
  }

  drawColumnHeader(ctx, spec);

  const maxValue = Math.max(...visibleEntries.map((entry) => entry.sharedMs), 1);
  visibleEntries.forEach((entry, index) => {
    drawRow(
      ctx,
      entry,
      startRank + index,
      ROW.top + index * ROW.height,
      ROW.height - ROW.gap,
      entry.sharedMs / maxValue,
      spec
    );
  });

  return canvas.toBuffer("image/png");
};
