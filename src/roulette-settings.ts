import { PermissionFlagsBits, type Guild, type Message } from "discord.js";
import { all, run, sql } from "./storage.js";

export type SettingsCommand = "타겟" | "관리자_타겟";
export const parseRoleId = (input: string | undefined): string | null => {
  const match = /^(?:<@&(\d{17,20})>|(\d{17,20}))$/.exec(input ?? "");
  return match?.[1] ?? match?.[2] ?? null;
};

const reply = (message: Message, content: string) =>
  message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });

export const handleRouletteSettingsCommand = async (
  message: Message, guild: Guild, command: SettingsCommand, args: string
): Promise<void> => {
  const owner = process.env.ADMIN_USER_ID?.trim();
  const isAdmin = (Boolean(owner) && message.author.id === owner)
    || (message.member?.permissions.has(PermissionFlagsBits.Administrator) ?? false);
  if (!isAdmin) {
    await reply(message, "서버 관리자만 사용할 수 있습니다.");
    return;
  }
  const [action, roleArg, ...rest] = args.split(/\s+/).filter(Boolean);
  const syntax = command === "타겟"
    ? "사용법: !타겟 지정 @역할 | 삭제 | 조회"
    : "사용법: !관리자_타겟 지정 @역할 | 삭제 @역할 | 조회";
  if (action === "조회" && !roleArg) {
    if (command === "타겟") {
      const id = sql<{ target_role_id: string | null }>(
        guild.id, "SELECT target_role_id FROM settings WHERE guild_id = ?", guild.id
      )?.target_role_id;
      await reply(message, id ? `타겟 역할: <@&${id}>` : "설정된 타겟 역할이 없습니다.");
    } else {
      const roles = all<{ role_id: string }>(guild.id,
        "SELECT role_id FROM admin_target_roles WHERE guild_id = ?", guild.id);
      await reply(message, roles.length
        ? `관리자 타겟 역할: ${roles.map(({role_id}) => `<@&${role_id}>`).join(", ")}`
        : "설정된 관리자 타겟 역할이 없습니다.");
    }
    return;
  }
  if (action === "삭제") {
    if (command === "타겟" && !roleArg) {
      run(guild.id, "UPDATE settings SET target_role_id = NULL WHERE guild_id = ?", guild.id);
      await reply(message, "타겟 역할 설정을 삭제했습니다.");
      return;
    }
    if (command === "관리자_타겟" && roleArg && !rest.length) {
      const roleId = parseRoleId(roleArg);
      if (!roleId) return void await reply(message, syntax);
      run(guild.id, "DELETE FROM admin_target_roles WHERE guild_id = ? AND role_id = ?", guild.id, roleId);
      await reply(message, "관리자 타겟 역할을 삭제했습니다.");
      return;
    }
  }
  if (action === "지정" && roleArg && !rest.length) {
    const roleId = parseRoleId(roleArg);
    if (!roleId) return void await reply(message, "역할 멘션 또는 역할 ID를 지정해 주세요.");
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.id === guild.id) return void await reply(message, "서버에서 역할을 찾을 수 없습니다.");
    if (command === "타겟") {
      const me = guild.members.me;
      if (role.managed || !me || role.position >= me.roles.highest.position) {
        await reply(message, "봇 역할보다 낮은 일반 역할만 설정할 수 있습니다.");
        return;
      }
      run(guild.id, `INSERT INTO settings (guild_id, target_role_id) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET target_role_id = excluded.target_role_id`, guild.id, role.id);
      await reply(message, `타겟 역할 설정: ${role.name}`);
    } else {
      run(guild.id, "INSERT OR IGNORE INTO admin_target_roles (guild_id, role_id) VALUES (?, ?)", guild.id, role.id);
      await reply(message, `관리자 타겟 역할 추가: ${role.name}`);
    }
    return;
  }
  await reply(message, syntax);
};
