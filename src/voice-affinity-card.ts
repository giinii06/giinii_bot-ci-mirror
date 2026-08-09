import { readFileSync } from "node:fs";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

GlobalFonts.register(readFileSync(new URL("./assets/BMDoHyeon-Regular.ttf", import.meta.url)), "BM DoHyeon");

export type VoiceAffinityEntry = { name: string; username: string; sharedMs: number };
export type VoiceCardMode = "affinity" | "volume" | "chat" | "activity";

const COLORS = {
  background: "#0b1020",
  panel: "#121b2d",
  panelRaised: "#18243a",
  row: "#1a2940",
  rowAlt: "#1d2d46",
  text: "#f8fafc",
  muted: "#a7b4c8",
  subtle: "#71829b",
  track: "#2c3b53",
  border: "#2a3a54",
  chat: "#f6c453",
  chatBright: "#ffe29a",
  voice: "#69e0d0",
  voiceBright: "#b1f5e9",
  activity: "#b9a5ff",
  activityBright: "#e1d9ff",
} as const;

const roundedRect = (ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
};

const fitText = (ctx: SKRSContext2D, text: string, width: number) => {
  if (ctx.measureText(text).width <= width) return text;
  let shortened = text;
  while (shortened && ctx.measureText(`${shortened}…`).width > width) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
};

const formatVoiceDuration = (milliseconds: number) => {
  if (milliseconds <= 0) return "0분";
  const minutes = Math.floor(milliseconds / 60_000);
  if (!minutes) return "1분 미만";
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
};

const formatCardValue = (value: number, mode: VoiceCardMode) => {
  if (mode === "chat") return `${Math.round(value).toLocaleString("ko-KR")}개`;
  if (mode === "activity") return `${Math.round(value).toLocaleString("ko-KR")}점`;
  return formatVoiceDuration(value);
};

const metricColor = (mode: VoiceCardMode) => mode === "chat" ? COLORS.chat : mode === "activity" ? COLORS.activity : COLORS.voice;
const metricBrightColor = (mode: VoiceCardMode) => mode === "chat" ? COLORS.chatBright : mode === "activity" ? COLORS.activityBright : COLORS.voiceBright;

const formatVoiceCheckedAt = (milliseconds: number) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
}).format(new Date(milliseconds));

export const renderVoiceAffinity = (
  targetName: string,
  entries: VoiceAffinityEntry[],
  checkedAt: number,
  startRank = 1,
  totalEntries = entries.length,
  mode: VoiceCardMode = "affinity",
  totalDurationMs = entries.reduce((sum, entry) => sum + entry.sharedMs, 0),
) => {
  const width = 2400;
  const height = 1350;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const font = '"BM DoHyeon"';
  const visibleEntries = entries.slice(0, 7);
  const maxSharedMs = Math.max(...visibleEntries.map((entry) => entry.sharedMs), 1);
  const title = totalEntries === 0
    ? mode === "affinity"
      ? `${targetName}님의 음성 친밀도 기록 없음`
      : mode === "volume"
        ? `${targetName} 통화량 기록 없음`
        : mode === "chat"
          ? `${targetName} 채팅량 기록 없음`
          : `${targetName} 종합 활동량 기록 없음`
    : mode === "affinity"
      ? `${targetName}님의 음성 친밀도 TOP ${totalEntries}`
      : mode === "volume"
        ? `${targetName} 통화량 TOP ${totalEntries}`
        : mode === "chat"
          ? `${targetName} 채팅량 TOP ${totalEntries}`
          : `${targetName} 종합 활동량 TOP ${totalEntries}`;
  const subtitle = mode === "affinity"
    ? "같은 음성 채널에 함께 있었던 시간"
    : mode === "volume"
      ? "음성 채널에 머문 시간"
      : mode === "chat"
        ? "보낸 메시지 수"
        : "메시지 1개 + 통화 1분 = 1점";
  const barLabel = mode === "affinity"
    ? "함께 있었던 비율"
    : mode === "volume"
      ? "통화량 비교"
      : mode === "chat"
        ? "메시지 비교"
        : "활동량 비교";
  const valueLabel = mode === "affinity"
    ? "함께 있던 시간"
    : mode === "volume"
      ? "통화량"
      : mode === "chat"
        ? "메시지 수"
        : "활동 점수";
  const accent = metricColor(mode);
  const accentBright = metricBrightColor(mode);
  const eyebrow = mode === "affinity" ? "VOICE AFFINITY" : `GIINII BOARD · ${mode === "chat" ? "CHAT" : mode === "volume" ? "VOICE" : "ACTIVITY"}`;
  const barGradient = ctx.createLinearGradient(820, 0, 1900, 0);
  barGradient.addColorStop(0, accent);
  barGradient.addColorStop(1, accentBright);

  const backgroundGradient = ctx.createLinearGradient(0, 0, width, height);
  backgroundGradient.addColorStop(0, COLORS.background);
  backgroundGradient.addColorStop(1, "#111a2e");
  ctx.fillStyle = backgroundGradient;
  ctx.fillRect(0, 0, width, height);

  const headerGradient = ctx.createLinearGradient(60, 42, 2340, 290);
  headerGradient.addColorStop(0, COLORS.panelRaised);
  headerGradient.addColorStop(1, COLORS.panel);
  roundedRect(ctx, 60, 42, 2280, 248, 36);
  ctx.fillStyle = headerGradient;
  ctx.fill();
  roundedRect(ctx, 60, 42, 2280, 10, 5);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = accent;
  ctx.font = `28px ${font}`;
  ctx.fillText(eyebrow, 114, 100);
  ctx.fillStyle = COLORS.text;
  ctx.font = `92px ${font}`;
  ctx.fillText(fitText(ctx, title, 1500), 110, 195);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `38px ${font}`;
  ctx.fillText(`${subtitle} · ${formatVoiceCheckedAt(checkedAt)} 기준`, 114, 270);
  ctx.textAlign = "center";
  const totalBoxX = mode === "affinity" ? 1960 : 1660;
  const totalBoxWidth = mode === "affinity" ? 330 : 630;
  const totalBoxCenter = totalBoxX + totalBoxWidth / 2;
  if (mode === "affinity") {
    roundedRect(ctx, 1660, 76, 270, 170, 24);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
  }
  roundedRect(ctx, totalBoxX, 76, totalBoxWidth, 170, 24);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  roundedRect(ctx, totalBoxX, 76, totalBoxWidth, 8, 4);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.font = `30px ${font}`;
  if (mode === "affinity") ctx.fillText("참여 인원", 1795, 122);
  ctx.fillText(mode === "affinity" ? "전체 함께한 시간" : mode === "chat" ? "전체 메시지" : mode === "activity" ? "전체 활동 점수" : "전체 통화량", totalBoxCenter, 122);
  ctx.fillStyle = COLORS.text;
  ctx.font = `62px ${font}`;
  if (mode === "affinity") ctx.fillText(`${visibleEntries.length}명`, 1795, 194);
  ctx.fillStyle = accentBright;
  ctx.font = `54px ${font}`;
  ctx.fillText(formatCardValue(totalDurationMs, mode), totalBoxCenter, 194);

  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.panel;
  roundedRect(ctx, 60, 320, 2280, 900, 36);
  ctx.fill();
  ctx.fillStyle = COLORS.subtle;
  ctx.font = `30px ${font}`;
  ctx.fillText(totalEntries === 0 ? "이 기간에는 아직 활동 기록이 없습니다" : `RANKING · TOP ${Math.min(totalEntries, 7)}`, 110, 360);
  ctx.font = `30px ${font}`;
  ctx.fillText("순위", 110, 415);
  ctx.fillText("멤버", 250, 415);
  ctx.fillText(barLabel, 820, 415);
  ctx.textAlign = "right";
  ctx.fillText(valueLabel, 2290, 415);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, 432);
  ctx.lineTo(2310, 432);
  ctx.stroke();

  if (visibleEntries.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.muted;
    ctx.font = `48px ${font}`;
    ctx.fillText("기록이 쌓이면 이곳에 순위가 표시됩니다", 1200, 780);
  }

  for (const [index, entry] of visibleEntries.entries()) {
    const rank = startRank + index;
    const y = 445 + index * 110;
    roundedRect(ctx, 90, y, 2220, 92, 24);
    ctx.fillStyle = rank === 1 ? "#352f24" : rank === 2 ? COLORS.rowAlt : rank === 3 ? "#332a28" : COLORS.row;
    ctx.fill();
    const rankColor = rank === 1 ? "#f5c84b" : rank === 2 ? "#cbd5e1" : rank === 3 ? "#d9965f" : "#64748b";
    roundedRect(ctx, 90, y, 12, 92, 6);
    ctx.fillStyle = rankColor;
    ctx.fill();
    roundedRect(ctx, 116, y + 18, 74, 56, 18);
    ctx.fillStyle = rankColor;
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = rank <= 3 ? "#182235" : COLORS.text;
    ctx.font = `34px ${font}`;
    ctx.fillText(String(rank).padStart(2, "0"), 153, y + 56);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = `48px ${font}`;
    ctx.fillText(fitText(ctx, entry.name, 480), 250, y + 43);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `28px ${font}`;
    ctx.fillText(fitText(ctx, `@${entry.username}`, 480), 250, y + 84);
    roundedRect(ctx, 820, y + 32, 1080, 28, 14);
    ctx.fillStyle = COLORS.track;
    ctx.fill();
    roundedRect(ctx, 820, y + 32, 1080 * Math.min(entry.sharedMs / maxSharedMs, 1), 28, 14);
    ctx.fillStyle = barGradient;
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = mode === "affinity" ? COLORS.text : accentBright;
    ctx.font = `44px ${font}`;
    ctx.fillText(formatCardValue(entry.sharedMs, mode), 2290, y + 59);
  }

  return canvas.toBuffer("image/png");
};
