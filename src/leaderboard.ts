import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, Image, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

GlobalFonts.registerFromPath(fileURLToPath(new URL("./assets/GowunDodum-Regular.ttf", import.meta.url)), "Gowun Dodum");

type AvatarEntry = { name: string; avatarUrl?: string };
type MemoryEntry = AvatarEntry & { content: string; imagePath?: string };
const avatarCache = new Map<string, Promise<Image | null>>();

function roundedRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
}
function fitText(ctx: SKRSContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let shortened = text;
  while (shortened && ctx.measureText(`${shortened}…`).width > width) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
}

function wrapText(ctx: SKRSContext2D, text: string, width: number) {
  return text.split("\n").flatMap((line) => {
    const lines: string[] = [];
    let current = "";
    for (const character of line || " ") {
      const next = current + character;
      if (current && ctx.measureText(next).width > width) {
        lines.push(current);
        current = character;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines;
  });
}

function avatarFor(url?: string) {
  if (!url) return Promise.resolve(null);
  let avatar = avatarCache.get(url);
  if (!avatar) {
    avatar = loadImage(url).catch(() => null);
    avatarCache.set(url, avatar);
  }
  return avatar;
}

function drawAvatar(ctx: SKRSContext2D, entry: AvatarEntry, avatar: Image | null, x: number, y: number, size: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, x, y, size, size);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, "#9f7aea");
    gradient.addColorStop(1, "#5b6ee1");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.floor(size * 0.42)}px "Gowun Dodum"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.name.slice(0, 1).toUpperCase(), x + size / 2, y + size / 2 + 1);
  }
  ctx.restore();
}
export async function renderMemory(eventName: string, owner: AvatarEntry, startedAt: string, entries: MemoryEntry[]) {
  const width = 900;
  const contentWidth = width - 240;
  const maxPageHeight = 1_800;
  const measureCtx = createCanvas(width, 1).getContext("2d");
  measureCtx.font = '500 20px "Gowun Dodum"';
  const entryLines = entries.map((entry) => wrapText(measureCtx, entry.content, contentWidth));
  const entryImages = await Promise.all(entries.map((entry) => entry.imagePath ? loadImage(entry.imagePath).catch(() => null) : null));
  const imageHeights = entryImages.map((image) => image ? Math.min(360, Math.round(contentWidth * image.height / image.width)) : 0);
  const cardHeights = entryLines.map((lines, index) => Math.max(168, 116 + lines.length * 31 + (imageHeights[index] ? imageHeights[index] + 22 : 0)));
  const pages: number[][] = [[]];
  let pageHeight = 500;
  for (const [index, cardHeight] of cardHeights.entries()) {
    if (pages.at(-1)!.length && pageHeight + cardHeight + 18 > maxPageHeight) {
      pages.push([]);
      pageHeight = 500;
    }
    pages.at(-1)!.push(index);
    pageHeight += cardHeight + 18;
  }
  const ownerAvatar = await avatarFor(owner.avatarUrl);
  const avatars = await Promise.all(entries.map((entry) => avatarFor(entry.avatarUrl)));

  return Promise.all(pages.map((page, pageIndex) => {
    const height = Math.max(760, 500 + page.reduce((total, index) => total + cardHeights[index] + 18, 0));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#0c0b16");
    background.addColorStop(0.48, "#151225");
    background.addColorStop(1, "#0a101a");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.shadowBlur = 110;
    ctx.shadowColor = "#8b5cf6";
    ctx.fillStyle = "#8b5cf6";
    ctx.beginPath();
    ctx.arc(width - 70, 40, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "#22d3ee";
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.arc(20, height - 80, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    roundedRect(ctx, 52, 42, 188, 38, 19);
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fill();
    ctx.fillStyle = "#a78bfa";
    ctx.beginPath();
    ctx.arc(74, 61, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8d2eb";
    ctx.font = '700 15px "Gowun Dodum"';
    ctx.fillText("MEMORY ARCHIVE", 91, 67);

    if (pages.length > 1) {
      roundedRect(ctx, 758, 42, 90, 38, 19);
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fill();
      ctx.fillStyle = "#c4b5fd";
      ctx.font = '700 15px "Gowun Dodum"';
      ctx.textAlign = "center";
      ctx.fillText(`${pageIndex + 1}  /  ${pages.length}`, 803, 67);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = '700 48px "Gowun Dodum"';
    ctx.fillText(fitText(ctx, eventName.replace(/\s+/g, " "), 796), 52, 139);
    ctx.fillStyle = "#8f8aa5";
    ctx.font = '500 19px "Gowun Dodum"';
    ctx.fillText(startedAt, 54, 177);

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.34)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    roundedRect(ctx, 40, 212, width - 80, 140, 28);
    const ownerCard = ctx.createLinearGradient(40, 212, width - 40, 352);
    ownerCard.addColorStop(0, "#6d4ae5");
    ownerCard.addColorStop(0.55, "#5131ae");
    ownerCard.addColorStop(1, "#30205f");
    ctx.fillStyle = ownerCard;
    ctx.fill();
    ctx.restore();
    roundedRect(ctx, 40, 212, width - 80, 140, 28);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawAvatar(ctx, owner, ownerAvatar, 68, 240, 84);
    ctx.beginPath();
    ctx.arc(110, 282, 44, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#d9d0ff";
    ctx.font = '700 15px "Gowun Dodum"';
    ctx.fillText("기록을 시작한 사람", 180, 258);
    ctx.fillStyle = "#ffffff";
    ctx.font = '700 28px "Gowun Dodum"';
    ctx.fillText(fitText(ctx, owner.name, 500), 180, 296);
    roundedRect(ctx, 696, 260, 116, 44, 22);
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = '700 17px "Gowun Dodum"';
    ctx.textAlign = "center";
    ctx.fillText(`${entries.length}개의 소감`, 754, 289);
    ctx.textAlign = "left";

    ctx.fillStyle = "#ffffff";
    ctx.font = '700 26px "Gowun Dodum"';
    ctx.fillText("함께 남긴 순간", 52, 414);
    ctx.fillStyle = "#777287";
    ctx.font = '500 16px "Gowun Dodum"';
    ctx.fillText("각자의 시선으로 기록한 오늘", 52, 442);
    let y = 470;
    for (const index of page) {
      const entry = entries[index];
      const lines = entryLines[index];
      const cardHeight = cardHeights[index];
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 10;
      roundedRect(ctx, 40, y, width - 80, cardHeight, 22);
      ctx.fillStyle = "rgba(28, 25, 45, 0.96)";
      ctx.fill();
      ctx.restore();
      roundedRect(ctx, 40, y, width - 80, cardHeight, 22);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      roundedRect(ctx, 40, y, 6, cardHeight, 3);
      const accent = ctx.createLinearGradient(40, y, 40, y + cardHeight);
      accent.addColorStop(0, "#a78bfa");
      accent.addColorStop(1, "#22d3ee");
      ctx.fillStyle = accent;
      ctx.fill();

      drawAvatar(ctx, entry, avatars[index], 68, y + 24, 64);
      ctx.beginPath();
      ctx.arc(100, y + 56, 34, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(167, 139, 250, 0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = '700 22px "Gowun Dodum"';
      ctx.fillText(fitText(ctx, entry.name, 500), 160, y + 49);
      ctx.fillStyle = "#8d879e";
      ctx.font = '500 15px "Gowun Dodum"';
      ctx.fillText("남긴 소감", 160, y + 75);
      roundedRect(ctx, 750, y + 24, 62, 30, 15);
      ctx.fillStyle = "rgba(167, 139, 250, 0.12)";
      ctx.fill();
      ctx.fillStyle = "#b8a5f8";
      ctx.font = '700 14px "Gowun Dodum"';
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1).padStart(2, "0"), 781, y + 45);
      ctx.textAlign = "left";

      ctx.fillStyle = "#d9d6e3";
      ctx.font = '500 19px "Gowun Dodum"';
      lines.forEach((line, lineIndex) => ctx.fillText(line, 160, y + 108 + lineIndex * 31));
      const attachedImage = entryImages[index];
      if (attachedImage) {
        const imageY = y + 120 + lines.length * 31;
        const imageHeight = imageHeights[index];
        const sourceRatio = attachedImage.width / attachedImage.height;
        const targetRatio = contentWidth / imageHeight;
        const sourceWidth = sourceRatio > targetRatio ? attachedImage.height * targetRatio : attachedImage.width;
        const sourceHeight = sourceRatio > targetRatio ? attachedImage.height : attachedImage.width / targetRatio;
        ctx.save();
        roundedRect(ctx, 160, imageY, contentWidth, imageHeight, 18);
        ctx.clip();
        ctx.drawImage(attachedImage, (attachedImage.width - sourceWidth) / 2, (attachedImage.height - sourceHeight) / 2, sourceWidth, sourceHeight, 160, imageY, contentWidth, imageHeight);
        ctx.restore();
        roundedRect(ctx, 160, imageY, contentWidth, imageHeight, 18);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      y += cardHeight + 18;
    }
    if (!page.length) {
      roundedRect(ctx, 40, y, width - 80, 160, 22);
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.fill();
      ctx.fillStyle = "#8f8aa5";
      ctx.font = '500 19px "Gowun Dodum"';
      ctx.textAlign = "center";
      ctx.fillText("아직 작성된 소감이 없습니다.", width / 2, y + 88);
      ctx.textAlign = "left";
    }
    ctx.fillStyle = "#5f5a70";
    ctx.font = '500 14px "Gowun Dodum"';
    ctx.textAlign = "center";
    ctx.fillText("우리의 순간을 오래도록 기억할게요", width / 2, height - 24);
    return canvas.toBuffer("image/png");
  }));
}
