import { PermissionFlagsBits, type Message } from "discord.js";
import type { MindEngine } from "./engine.js";
import type { MemoryActor, MemoryCategory, MemoryRecord, MemoryVisibility } from "./types.js";

const send = async (message: Message, text: string): Promise<void> => {
  for (const chunk of text.match(/[\s\S]{1,1900}/g) ?? [""]) {
    await message.reply({ content: chunk, allowedMentions: { parse: [], repliedUser: false } });
  }
};
const line = (memory: MemoryRecord) => `${memory.id}. [${memory.category}] ${memory.content}`;
const positiveId = (value: string | undefined): number | null => {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const mentionId = (value: string | undefined) => /^<@!?(\d{17,20})>$/.exec(value ?? "")?.[1] ?? null;
const isAdmin = (message: Message): boolean => {
  const owner = process.env.ADMIN_USER_ID?.trim();
  return (Boolean(owner) && owner === message.author.id)
    || (message.member?.permissions.has(PermissionFlagsBits.Administrator) ?? false);
};
const actorOf = (message: Message): MemoryActor => ({
  userId: message.author.id,
  guildId: message.guildId!,
  isAdministrator: true,
  source: "discord_message"
});

export const handleMindCommand = async (message: Message, engine: MindEngine, args: string): Promise<void> => {
  if (!isAdmin(message)) return send(message, "서버 관리자만 사용할 수 있습니다.");
  if (args !== "status") return send(message, "사용법: !mind status");
  const status = engine.status();
  await send(message, [
    `상태: ${status.enabled ? "켜짐" : "꺼짐"} · 회로 ${status.breaker}`,
    `Decision 모델: ${status.model}`,
    `24시간 ${status.usage.last24h}/${status.usage.dailyBudget} · 1분 ${status.usage.lastMinute}/${status.usage.minuteBudget}`,
    `실패율: ${(status.failureRate * 100).toFixed(1)}%`
  ].join("\n"));
};

export const handleMemoryCommand = async (message: Message, engine: MindEngine, args: string): Promise<void> => {
  const [action, rawId, value, ...extra] = args.split(/\s+/).filter(Boolean);
  const userId = message.author.id;
  if (action === "list" && !rawId) {
    const memories = engine.listMemories(userId, 25);
    await send(message, memories.length
      ? memories.map((memory) => `${line(memory)} (${memory.visibility === "shareable" ? "공유 가능" : "비공개"})`).join("\n")
      : "저장된 기억이 없습니다.");
    return;
  }
  if (action === "delete" && !value) {
    const id = positiveId(rawId);
    if (!id) return send(message, "사용법: !memory delete <번호>");
    const deleted = engine.memories.deletePersonal(id, userId);
    await send(message, deleted ? `기억 ${id}번 삭제 완료.` : "해당 번호의 본인 기억이 없습니다.");
    return;
  }
  if (action === "clear" && rawId === "confirm" && !value) {
    const count = engine.clearMemories(userId);
    await send(message, `개인 기억 ${count}개와 관계 추정값을 초기화했습니다. 원본 채팅·공용 기억은 유지됩니다.`);
    return;
  }
  if (action === "visibility" && !extra.length && (value === "private" || value === "shareable")) {
    const id = positiveId(rawId);
    if (!id) return send(message, "사용법: !memory visibility <번호> <private|shareable>");
    const changed = engine.setMemoryVisibility(userId, id, value as MemoryVisibility);
    await send(message, changed ? `기억 ${id}번 공개 범위: ${value}` : "해당 번호의 본인 기억이 없습니다.");
    return;
  }
  await send(message, "사용법: !memory list | delete <번호> | clear confirm | visibility <번호> <private|shareable>");
};

export const handleSharedMemoryCommand = async (message: Message, engine: MindEngine, args: string): Promise<void> => {
  if (!message.guildId || !isAdmin(message)) return send(message, "서버 관리자만 사용할 수 있습니다.");
  const [action, ...parts] = args.trim().split(/\s+/).filter(Boolean);
  const actor = actorOf(message);
  if (action === "list" && !parts.length) {
    const memories = engine.listGuildMemories(50);
    await send(message, memories.length ? memories.map(line).join("\n") : "저장된 공용 기억이 없습니다.");
    return;
  }
  if (action === "add") {
    const [category, ...tail] = parts;
    if (!["fact", "preference", "server_convention"].includes(category ?? "")) {
      return send(message, "사용법: !shared-memory add <fact|preference|server_convention> [@유저] <내용>");
    }
    const subjectId = mentionId(tail[0]);
    if (subjectId) tail.shift();
    const content = tail.join(" ").trim();
    if (!content || content.length > 1000) return send(message, "내용을 1~1000자로 입력해 주세요.");
    if (subjectId && !(await message.guild?.members.fetch(subjectId).catch(() => null))) {
      return send(message, "해당 서버의 사용자를 찾을 수 없습니다.");
    }
    const saved = engine.addGuildMemory({
      actor, category: category as MemoryCategory, subjectUserId: subjectId, content
    });
    await send(message, saved ? `공용 기억 ${saved.id}번 저장 완료.` : "중복된 내용이거나 저장하지 못했습니다.");
    return;
  }
  if (action === "edit" && parts.length >= 2) {
    const id = positiveId(parts[0]);
    const content = parts.slice(1).join(" ").trim();
    if (!id || !content || content.length > 1000) return send(message, "사용법: !shared-memory edit <번호> <새 내용, 1000자 이하>");
    const changed = engine.updateGuildMemory(id, actor, { content });
    await send(message, changed ? `공용 기억 ${id}번 수정 완료.` : "해당 기억이 없습니다.");
    return;
  }
  if (action === "delete" && parts.length === 1) {
    const id = positiveId(parts[0]);
    if (!id) return send(message, "사용법: !shared-memory delete <번호>");
    const removed = engine.deleteGuildMemory(id, actor);
    await send(message, removed ? `공용 기억 ${id}번 삭제 완료.` : "해당 기억이 없습니다.");
    return;
  }
  if (action === "nickname" && parts.length >= 2) {
    const userId = mentionId(parts[0]);
    if (!userId) return send(message, "사용법: !shared-memory nickname @유저 <별명>");
    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) return send(message, "서버에서 해당 유저를 찾을 수 없습니다.");
    const nickname = parts.slice(1).join(" ").trim();
    if (!nickname || nickname.length > 100) return send(message, "별명은 1~100자로 입력해 주세요.");
    const result = engine.setGuildNickname({
      actor, subjectUserId: userId, subjectDisplayName: member.displayName, nickname
    });
    await send(message, result.ok ? `${member.displayName}님의 별명 설정 완료.` : result.reason);
    return;
  }
  await send(message, [
    "사용법: !shared-memory list",
    "!shared-memory add <fact|preference|server_convention> [@유저] <내용>",
    "!shared-memory edit <번호> <내용> | delete <번호>",
    "!shared-memory nickname @유저 <별명>"
  ].join("\n"));
};
