import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, Image, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

GlobalFonts.registerFromPath(fileURLToPath(new URL("./assets/GowunDodum-Regular.ttf", import.meta.url)), "Gowun Dodum");

type AvatarEntry = { name: string; avatarUrl?: string };
type LeaderboardEntry = AvatarEntry & { xp: number };
type RankEntry = AvatarEntry & { xp: number; level: number; rank: number };
type ShopEntry = { name: string; price: number; purchased?: boolean };
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
  ctx.fillText("XP 리더보드", 58, 116);
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
  ctx.fillText("XP 경험치 상점", 58, 116);
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
