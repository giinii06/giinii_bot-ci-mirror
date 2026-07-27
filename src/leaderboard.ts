import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, Image, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

GlobalFonts.registerFromPath(fileURLToPath(new URL("./assets/GowunDodum-Regular.ttf", import.meta.url)), "Gowun Dodum");

type AvatarEntry = { name: string; avatarUrl?: string };
type LeaderboardEntry = AvatarEntry & { xp: number };
type RankEntry = AvatarEntry & { xp: number; level: number; rank: number };
type ShopEntry = { name: string; price: number; purchased?: boolean };
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

export async function renderLeaderboard(guildName: string, entries: LeaderboardEntry[], startRank = 1) {
  const width = 900;
  const rowHeight = 82;
  const height = 192 + entries.length * rowHeight + 34;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const avatars = await Promise.all(entries.map((entry) => avatarFor(entry.avatarUrl)));
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#17132f");
  background.addColorStop(1, "#35235b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#c4b5fd";
  ctx.font = '500 24px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, guildName, 700), 58, 61);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 44px "Gowun Dodum"';
  ctx.fillText("이벤트 경험치 리더보드", 58, 116);
  ctx.fillStyle = "#b9a7ee";
  ctx.font = '500 18px "Gowun Dodum"';
  ctx.fillText(`누적 XP 순위 · ${startRank}–${startRank + entries.length - 1}위`, 60, 151);

  for (const [index, entry] of entries.entries()) {
    const rank = startRank + index;
    const y = 181 + index * rowHeight;
    roundedRect(ctx, 40, y, width - 80, 68, 18);
    ctx.fillStyle = rank <= 3 ? ["#45316f", "#392b61", "#302653"][rank - 1] : "#261d44";
    ctx.fill();
    ctx.fillStyle = ["#f7cf68", "#d5d9e5", "#df9a62"][rank - 1] ?? "#a99ccf";
    ctx.font = '700 22px "Gowun Dodum"';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(rank).padStart(2, "0"), 78, y + 34);
    drawAvatar(ctx, entry, avatars[index], 112, y + 10, 48);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = '700 23px "Gowun Dodum"';
    ctx.fillText(fitText(ctx, entry.name, 470), 180, y + 35);
    ctx.fillStyle = "#d9ceff";
    ctx.font = '700 23px "Gowun Dodum"';
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(entry.xp).toLocaleString("ko-KR")} XP`, 820, y + 35);
  }
  return canvas.toBuffer("image/png");
}

export async function renderRank(entry: RankEntry) {
  const width = 1200;
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const avatar = await avatarFor(entry.avatarUrl);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#24272a");
  background.addColorStop(1, "#363a3d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  drawAvatar(ctx, entry, avatar, 120, 60, 280);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 70px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, entry.name, 650), 480, 170);
  ctx.fillStyle = "#5eb7ff";
  ctx.font = '700 58px "Gowun Dodum"';
  ctx.fillText(`LEVEL ${entry.level}`, 480, 230);
  ctx.fillStyle = "#aeb5bc";
  ctx.fillText(`RANK #${entry.rank}`, 780, 230);
  ctx.fillStyle = "#4daeff";
  ctx.font = '700 30px "Gowun Dodum"';
  ctx.fillText(`${Math.round(entry.xp).toLocaleString("ko-KR")} EXP`, 480, 265);
  return canvas.toBuffer("image/png");
}

export async function renderLevelUp(guildName: string, entry: AvatarEntry, level: number) {
  const width = 900;
  const height = 280;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const avatar = await avatarFor(entry.avatarUrl);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#17132f");
  background.addColorStop(1, "#35235b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#c4b5fd";
  ctx.font = '500 24px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, guildName, 700), 58, 61);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 44px "Gowun Dodum"';
  ctx.fillText("레벨 업!", 58, 116);
  drawAvatar(ctx, entry, avatar, 58, 151, 82);
  ctx.font = '700 29px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, `${entry.name}님이 ${level}레벨을 달성하였습니다!`, 680), 164, 190);
  ctx.fillStyle = "#d9ceff";
  ctx.font = '700 22px "Gowun Dodum"';
  ctx.fillText(`LEVEL ${level}`, 164, 222);
  return canvas.toBuffer("image/png");
}

export async function renderShopPurchase(guildName: string, entry: AvatarEntry, itemName: string, price: number) {
  const width = 900;
  const height = 470;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const avatar = await avatarFor(entry.avatarUrl);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#17132f");
  background.addColorStop(1, "#35235b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#c4b5fd";
  ctx.font = '500 24px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, guildName, 700), 58, 61);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 44px "Gowun Dodum"';
  ctx.fillText("경험치샵 구매 알림", 58, 116);
  drawAvatar(ctx, entry, avatar, 58, 151, 82);
  ctx.font = '700 27px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, `${entry.name}님이 상점에서 아이템을 구매했습니다.`, 680), 164, 192);

  roundedRect(ctx, 40, 265, width - 80, 155, 24);
  ctx.fillStyle = "#261d44";
  ctx.fill();
  ctx.fillStyle = "#b9a7ee";
  ctx.font = '500 18px "Gowun Dodum"';
  ctx.fillText("아이템", 76, 310);
  ctx.fillText("가격", 76, 382);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 28px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, itemName, 710), 76, 344);
  ctx.fillStyle = "#d9ceff";
  ctx.fillText(`${Math.round(price).toLocaleString("ko-KR")} EXP`, 76, 416);
  return canvas.toBuffer("image/png");
}

export async function renderTransferReceipt(guildName: string, sender: AvatarEntry & { xp: number }, receiver: AvatarEntry & { xp: number }, amount: number) {
  const width = 900;
  const height = 470;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const [senderAvatar, receiverAvatar] = await Promise.all([avatarFor(sender.avatarUrl), avatarFor(receiver.avatarUrl)]);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#17132f");
  background.addColorStop(1, "#35235b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#c4b5fd";
  ctx.font = '500 24px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, guildName, 700), 58, 61);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 44px "Gowun Dodum"';
  ctx.fillText("XP 송금 완료", 58, 116);
  ctx.fillStyle = "#b9a7ee";
  ctx.font = '500 18px "Gowun Dodum"';
  ctx.fillText("TRANSFER RECEIPT", 60, 151);

  roundedRect(ctx, 40, 181, width - 80, 245, 24);
  ctx.fillStyle = "#261d44";
  ctx.fill();
  drawAvatar(ctx, sender, senderAvatar, 116, 211, 96);
  drawAvatar(ctx, receiver, receiverAvatar, 688, 211, 96);
  ctx.fillStyle = "#b9a7ee";
  ctx.font = '500 17px "Gowun Dodum"';
  ctx.textAlign = "center";
  ctx.fillText("보낸 사람", 164, 334);
  ctx.fillText("받는 사람", 736, 334);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 24px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, sender.name, 210), 164, 366);
  ctx.fillText(fitText(ctx, receiver.name, 210), 736, 366);
  ctx.fillStyle = "#d9ceff";
  ctx.font = '700 18px "Gowun Dodum"';
  ctx.fillText(`송금 후 ${(Math.round(sender.xp * 100) / 100).toLocaleString("ko-KR")} XP`, 164, 402);
  ctx.fillText(`송금 후 ${(Math.round(receiver.xp * 100) / 100).toLocaleString("ko-KR")} XP`, 736, 402);
  ctx.fillStyle = "#8b5cf6";
  roundedRect(ctx, 307, 231, 286, 86, 43);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 30px "Gowun Dodum"';
  ctx.fillText(`${(Math.round(amount * 100) / 100).toLocaleString("ko-KR")} XP`, 450, 270);
  ctx.font = '700 18px "Gowun Dodum"';
  ctx.fillText("송금 완료  →", 450, 298);
  ctx.textAlign = "left";
  return canvas.toBuffer("image/png");
}

export function renderShop(guildName: string, entries: ShopEntry[], balance: number, startRank = 1) {
  const width = 900;
  const rowHeight = 82;
  const height = 192 + entries.length * rowHeight + 34;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#17132f");
  background.addColorStop(1, "#35235b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#c4b5fd";
  ctx.font = '500 24px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, guildName, 700), 58, 61);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 44px "Gowun Dodum"';
  ctx.fillText("이벤트 경험치 상점", 58, 116);
  ctx.fillStyle = "#b9a7ee";
  ctx.font = '500 18px "Gowun Dodum"';
  ctx.fillText("보상을 선택하고 아래 구매 버튼을 누르세요", 60, 151);
  ctx.textAlign = "right";
  ctx.fillText(`보유 XP ${Math.round(balance).toLocaleString("ko-KR")}`, 840, 151);

  for (const [index, entry] of entries.entries()) {
    const y = 181 + index * rowHeight;
    roundedRect(ctx, 40, y, width - 80, 68, 18);
    ctx.fillStyle = "#261d44";
    ctx.fill();
    ctx.fillStyle = "#a99ccf";
    ctx.font = '700 22px "Gowun Dodum"';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(startRank + index).padStart(2, "0"), 78, y + 34);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = '700 23px "Gowun Dodum"';
    const name = fitText(ctx, entry.name, entry.purchased ? 430 : 470);
    ctx.fillText(name, 118, y + 30);
    if (entry.purchased) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(118, y + 43);
      ctx.lineTo(118 + ctx.measureText(name).width, y + 43);
      ctx.stroke();
      ctx.fillStyle = "#86efac";
      ctx.font = '700 18px "Gowun Dodum"';
      ctx.strokeStyle = "#86efac";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(600, y + 30);
      ctx.lineTo(607, y + 37);
      ctx.lineTo(620, y + 23);
      ctx.stroke();
      ctx.fillText("구매됨", 628, y + 30);
    }
    ctx.fillStyle = "#d9ceff";
    ctx.font = '700 23px "Gowun Dodum"';
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(entry.price).toLocaleString("ko-KR")} XP`, 820, y + 35);
  }
  return canvas.toBuffer("image/png");
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

export function renderHeartLetter(guildName: string, content: string) {
  const width = 1_000;
  const contentWidth = width - 264;
  const measureCtx = createCanvas(width, 1).getContext("2d");
  measureCtx.font = '500 24px "Gowun Dodum"';
  const lines = wrapText(measureCtx, content, contentWidth);
  const lineHeight = 38;
  const height = Math.max(520, 400 + lines.length * lineHeight);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#10141f");
  background.addColorStop(0.5, "#171827");
  background.addColorStop(1, "#0b0c12");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.shadowBlur = 100;
  ctx.shadowColor = "#ff4fa3";
  ctx.fillStyle = "#ff4fa3";
  ctx.beginPath();
  ctx.arc(120, 80, 92, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "#6ea8ff";
  ctx.fillStyle = "#6ea8ff";
  ctx.beginPath();
  ctx.arc(width - 80, height - 80, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 18;
  roundedRect(ctx, 46, 54, width - 92, height - 100, 34);
  ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
  ctx.fill();
  ctx.restore();

  roundedRect(ctx, 46, 54, width - 92, height - 100, 34);
  const glass = ctx.createLinearGradient(46, 54, width - 46, height - 46);
  glass.addColorStop(0, "rgba(255, 255, 255, 0.18)");
  glass.addColorStop(0.45, "rgba(255, 255, 255, 0.07)");
  glass.addColorStop(1, "rgba(255, 255, 255, 0.03)");
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.26)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  roundedRect(ctx, 64, 72, width - 128, 116, 27);
  const gloss = ctx.createLinearGradient(64, 72, 64, 188);
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0.02)");
  ctx.fillStyle = gloss;
  ctx.fill();

  ctx.fillStyle = "#ff8fbd";
  ctx.beginPath();
  ctx.arc(105, 130, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 22px "Gowun Dodum"';
  ctx.textAlign = "center";
  ctx.fillText("♥", 105, 138);
  ctx.textAlign = "left";

  ctx.fillStyle = "#a5a8b0";
  ctx.font = '500 17px "Gowun Dodum"';
  ctx.fillText("ANONYMOUS MESSAGE", 150, 111);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 39px "Gowun Dodum"';
  ctx.fillText("마음의 편지", 150, 153);
  ctx.fillStyle = "#ff93c5";
  ctx.font = '500 21px "Gowun Dodum"';
  ctx.fillText(fitText(ctx, guildName, width - 220), 150, 181);

  const cardY = 226;
  const cardHeight = height - 300;
  roundedRect(ctx, 88, cardY, width - 176, cardHeight, 26);
  const messageGlass = ctx.createLinearGradient(88, cardY, width - 88, cardY + cardHeight);
  messageGlass.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  messageGlass.addColorStop(1, "rgba(255, 255, 255, 0.06)");
  ctx.fillStyle = messageGlass;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = '500 24px "Gowun Dodum"';
  lines.forEach((line, index) => ctx.fillText(line, 132, 292 + index * lineHeight));
  ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
  ctx.font = '500 17px "Gowun Dodum"';
  ctx.fillText("익명으로 전달된 메시지", 132, height - 92);
  return canvas.toBuffer("image/png");
}
