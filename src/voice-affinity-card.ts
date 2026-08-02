import { readFileSync } from "node:fs";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

GlobalFonts.register(readFileSync(new URL("./assets/BMDoHyeon-Regular.ttf", import.meta.url)), "BM DoHyeon");

export type VoiceAffinityEntry = { name: string; username: string; sharedMs: number };

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
  const minutes = Math.floor(milliseconds / 60_000);
  if (!minutes) return "1분 미만";
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
};

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
) => {
  const width = 2400;
  const height = 1350;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const font = '"BM DoHyeon"';
  const visibleEntries = entries.slice(0, 7);
  const maxSharedMs = Math.max(...visibleEntries.map((entry) => entry.sharedMs), 1);
  const totalSharedMs = visibleEntries.reduce((sum, entry) => sum + entry.sharedMs, 0);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#172033";
  roundedRect(ctx, 60, 42, 2280, 248, 36);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `104px ${font}`;
  ctx.fillText(fitText(ctx, `${targetName}님의 음성 친밀도 TOP ${totalEntries}`, 1500), 110, 195);
  ctx.fillStyle = "#b7c0d0";
  ctx.font = `42px ${font}`;
  ctx.fillText(`같은 음성 채널에 함께 있었던 시간 · ${formatVoiceCheckedAt(checkedAt)} 기준`, 114, 270);
  ctx.textAlign = "center";
  roundedRect(ctx, 1660, 76, 270, 170, 24);
  ctx.fillStyle = "#202d43";
  ctx.fill();
  roundedRect(ctx, 1960, 76, 330, 170, 24);
  ctx.fill();
  ctx.fillStyle = "#b7c0d0";
  ctx.font = `32px ${font}`;
  ctx.fillText("참여 인원", 1795, 122);
  ctx.fillText("전체 함께한 시간", 2125, 122);
  ctx.fillStyle = "#ffffff";
  ctx.font = `64px ${font}`;
  ctx.fillText(`${visibleEntries.length}명`, 1795, 194);
  ctx.fillStyle = "#7de2d2";
  ctx.font = `54px ${font}`;
  ctx.fillText(formatVoiceDuration(totalSharedMs), 2125, 194);

  ctx.textAlign = "left";
  ctx.fillStyle = "#172033";
  roundedRect(ctx, 60, 320, 2280, 900, 36);
  ctx.fill();
  ctx.fillStyle = "#94a3b8";
  ctx.font = `32px ${font}`;
  ctx.fillText("순위", 110, 375);
  ctx.fillText("멤버", 250, 375);
  ctx.fillText("함께 있었던 비율", 820, 375);
  ctx.textAlign = "right";
  ctx.fillText("함께 있던 시간", 2290, 375);

  for (const [index, entry] of visibleEntries.entries()) {
    const rank = startRank + index;
    const y = 405 + index * 110;
    roundedRect(ctx, 90, y, 2220, 92, 24);
    ctx.fillStyle = rank === 1 ? "#3b3020" : rank === 2 ? "#263343" : rank === 3 ? "#3a2a24" : "#1e293b";
    ctx.fill();
    ctx.fillStyle = rank === 1 ? "#f5c84b" : rank === 2 ? "#cbd5e1" : rank === 3 ? "#d9965f" : "#64748b";
    roundedRect(ctx, 90, y, 12, 92, 6);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.font = `48px ${font}`;
    ctx.fillText(String(rank).padStart(2, "0"), 140, y + 62);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `50px ${font}`;
    ctx.fillText(fitText(ctx, entry.name, 480), 250, y + 43);
    ctx.fillStyle = "#94a3b8";
    ctx.font = `30px ${font}`;
    ctx.fillText(fitText(ctx, `@${entry.username}`, 480), 250, y + 84);
    roundedRect(ctx, 820, y + 32, 1080, 28, 14);
    ctx.fillStyle = "#334155";
    ctx.fill();
    roundedRect(ctx, 820, y + 32, 1080 * (entry.sharedMs / maxSharedMs), 28, 14);
    ctx.fillStyle = "#4fd1c5";
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = "#f8fafc";
    ctx.font = `46px ${font}`;
    ctx.fillText(formatVoiceDuration(entry.sharedMs), 2290, y + 59);
  }

  return canvas.toBuffer("image/png");
};
