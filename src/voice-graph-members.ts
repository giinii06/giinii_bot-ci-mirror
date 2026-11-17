import type { Client, Guild } from "discord.js";

export type VoiceGraphMemberInfo = { userId: string; name: string; avatarUrl: string | null };

/**
 * 표시 이름과 아바타를 정한다. 2D PNG와 3D 화면이 같은 값을 쓰도록 한 곳에 둔다.
 * 길드 멤버 목록 조회는 GuildMembers intent가 필요하므로 단건 조회만 쓴다.
 */
export const resolveVoiceGraphMembers = async (
  guild: Guild,
  client: Client,
  userIds: readonly string[],
): Promise<VoiceGraphMemberInfo[]> => Promise.all(userIds.map(async (userId) => {
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user ?? await client.users.fetch(userId).catch(() => null);
  return {
    userId,
    name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
    avatarUrl: member?.displayAvatarURL({ extension: "png", size: 256 })
      ?? user?.displayAvatarURL({ extension: "png", size: 256 }) ?? null,
  };
}));
