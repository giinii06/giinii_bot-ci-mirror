import type { Client, Guild } from "discord.js";

export type VoiceGraphMemberInfo = { userId: string; name: string; avatarUrl: string | null };

/**
 * 표시 이름과 아바타를 정한다. 2D PNG와 3D 화면이 같은 값을 쓰도록 한 곳에 둔다.
 * 길드 멤버 목록 조회는 GuildMembers intent가 필요하므로 단건 조회만 쓴다.
 *
 * 단건 조회도 20명을 한꺼번에 던지면 길드 멤버 라우트의 버킷에 걸려 429를 받고,
 * discord.js가 재시도 대기까지 하면서 스냅샷 하나가 몇 초씩 늘어난다. 이름과 아바타는
 * 몇 분 안에 바뀌지 않으므로 해석 결과를 재사용한다.
 */
export type MemberCache = Map<string, { at: number; info: VoiceGraphMemberInfo }>;

export const MEMBER_CACHE_TTL_MS = 10 * 60_000;

const resolveOne = async (
  guild: Guild,
  client: Client,
  userId: string,
): Promise<VoiceGraphMemberInfo> => {
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user ?? await client.users.fetch(userId).catch(() => null);
  return {
    userId,
    name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
    avatarUrl: member?.displayAvatarURL({ extension: "png", size: 256 })
      ?? user?.displayAvatarURL({ extension: "png", size: 256 }) ?? null,
  };
};

export const resolveVoiceGraphMembers = async (
  guild: Guild,
  client: Client,
  userIds: readonly string[],
  cache?: MemberCache,
  now: number = Date.now(),
): Promise<VoiceGraphMemberInfo[]> => {
  const keyOf = (userId: string) => `${guild.id}:${userId}`;
  const resolved = new Map<string, VoiceGraphMemberInfo>();
  const missing: string[] = [];

  for (const userId of userIds) {
    const hit = cache?.get(keyOf(userId));
    if (hit && now - hit.at < MEMBER_CACHE_TTL_MS) resolved.set(userId, hit.info);
    else missing.push(userId);
  }

  const fetched = await Promise.all(missing.map(async (userId) => {
    const info = await resolveOne(guild, client, userId);
    cache?.set(keyOf(userId), { at: now, info });
    return info;
  }));
  for (const info of fetched) resolved.set(info.userId, info);

  return userIds.map((userId) => resolved.get(userId)!);
};
