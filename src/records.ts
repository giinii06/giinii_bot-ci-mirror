import type { Guild, Snowflake } from "discord.js";
import { avatarMedia, bannerMedia, profileFromMember, type HistoryMessage, type MediaRecord, type MessageProfile } from "./history.js";
import { all, beginTransaction, commitTransaction, listGuildIds, rollbackTransaction, run, sql } from "./storage.js";

const SEPARATOR = "\u001F";

/** 같은 값이면 같은 행이 된다. 닉네임/아바타가 실제로 바뀔 때만 새 이력이 쌓인다. */
const identityOf = (profile: MessageProfile) => [
  profile.username, profile.globalName ?? "", profile.nickname ?? "", profile.displayName,
  profile.avatarHash ?? "", profile.bannerHash ?? "", String(profile.accentColor ?? "")
].join(SEPARATOR);

export const recordProfileSnapshot = (
  guildId: string,
  profile: MessageProfile,
  observedAt: number,
  source: string
) => run(guildId, `INSERT INTO user_profiles (
      guild_id, user_id, observed_at, source, username, global_name, nickname, display_name,
      avatar_hash, avatar_url, banner_hash, banner_url, accent_color, bot, public_flags, identity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id, identity) DO NOTHING`,
    guildId, profile.userId, observedAt, source,
    profile.username, profile.globalName, profile.nickname, profile.displayName,
    profile.avatarHash, profile.avatarUrl, profile.bannerHash, profile.bannerUrl,
    profile.accentColor, profile.bot ? 1 : 0, profile.publicFlags, identityOf(profile)
  ).changes;

const recordMediaRows = (
  guildId: string,
  message: HistoryMessage | null,
  items: MediaRecord[]
) => {
  let stored = 0;
  for (const item of items) {
    stored += run(guildId, `INSERT INTO media_files (
        media_id, kind, guild_id, channel_id, message_id, owner_user_id, filename, content_type,
        bytes, width, height, duration, url, status, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT (media_id) DO NOTHING`,
      item.mediaId, item.kind, guildId, message?.channelId ?? null, message?.messageId ?? null,
      item.ownerUserId, item.filename, item.contentType,
      item.bytes, item.width, item.height, item.duration, item.url, Date.now()
    ).changes;
  }
  return stored;
};

const recordDetailRow = (guildId: string, message: HistoryMessage) => {
  const detail = message.detail;
  if (!detail) return 0;
  return run(guildId, `INSERT INTO message_details (
      message_id, guild_id, channel_id, author_id, message_type, pinned, edited_timestamp, webhook_id,
      reply_to_message_id, thread_id, mentions_everyone, mention_user_ids, mention_role_ids,
      mention_channel_ids, reaction_summary, embed_count, component_count, position, flags, raw, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (message_id) DO UPDATE SET
      message_type = excluded.message_type, pinned = excluded.pinned,
      edited_timestamp = excluded.edited_timestamp, reply_to_message_id = excluded.reply_to_message_id,
      mentions_everyone = excluded.mentions_everyone, mention_user_ids = excluded.mention_user_ids,
      mention_role_ids = excluded.mention_role_ids, mention_channel_ids = excluded.mention_channel_ids,
      reaction_summary = excluded.reaction_summary, embed_count = excluded.embed_count,
      component_count = excluded.component_count, position = excluded.position,
      flags = excluded.flags, raw = excluded.raw, recorded_at = excluded.recorded_at`,
    message.messageId, guildId, message.channelId, message.authorId, detail.messageType,
    detail.pinned ? 1 : 0, detail.editedTimestamp, detail.webhookId, detail.replyToMessageId,
    detail.threadId, detail.mentionsEveryone ? 1 : 0,
    JSON.stringify(detail.mentionUserIds), JSON.stringify(detail.mentionRoleIds),
    JSON.stringify(detail.mentionChannelIds), JSON.stringify(detail.reactionSummary),
    detail.embedCount, detail.componentCount, detail.position, detail.flags, detail.raw, Date.now()
  ).changes;
};

/** 새로 적재된 메시지만 기록한다. 프로필은 실제로 달라졌을 때만 이력에 한 줄 추가한다. */
export const recordMessageRecords = (guildId: string, messages: HistoryMessage[]) => {
  if (messages.length === 0) return { details: 0, media: 0, profiles: 0 };
  let details = 0;
  let media = 0;
  let profiles = 0;
  beginTransaction(guildId);
  try {
    for (const message of messages) {
      details += recordDetailRow(guildId, message);
      const messageScoped = message.media.filter((item) => item.kind === "attachment" || item.kind === "sticker");
      const identityScoped = message.media.filter((item) => item.kind === "avatar" || item.kind === "banner");
      media += recordMediaRows(guildId, message, messageScoped);
      if (message.profile) {
        const appended = recordProfileSnapshot(guildId, message.profile, message.createdTimestamp, "message");
        profiles += appended;
        if (appended > 0) media += recordMediaRows(guildId, message, identityScoped);
      }
    }
    commitTransaction(guildId);
  } catch (error) {
    rollbackTransaction(guildId);
    throw error;
  }
  return { details, media, profiles };
};

/**
 * 예전에는 표시 이름만 저장돼 있었다. 이미 쌓인 메시지에서 닉네임 이력을 소급 복원한다.
 * 같은 유저가 같은 이름을 쓴 구간은 최초 시각 하나로 접힌다.
 */
export const seedProfileHistoryFromMessages = () => {
  let seeded = 0;
  for (const guildId of listGuildIds()) {
    const already = sql<{ present: number }>(
      guildId, "SELECT EXISTS(SELECT 1 FROM user_profiles WHERE guild_id = ? AND source = 'history-seed') AS present", guildId
    )?.present;
    if (already) continue;

    const rows = all<{ author_id: string; author_name: string; first_seen: number }>(
      guildId,
      `SELECT author_id, author_name, MIN(created_at) AS first_seen
       FROM discord_messages
       WHERE guild_id = ? AND TRIM(author_name) <> ''
       GROUP BY author_id, author_name
       ORDER BY author_id, first_seen`,
      guildId
    );
    beginTransaction(guildId);
    try {
      for (const row of rows) {
        seeded += run(guildId, `INSERT INTO user_profiles (
            guild_id, user_id, observed_at, source, username, global_name, nickname, display_name,
            avatar_hash, avatar_url, banner_hash, banner_url, accent_color, bot, public_flags, identity
          ) VALUES (?, ?, ?, 'history-seed', '', NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)
          ON CONFLICT (guild_id, user_id, identity) DO NOTHING`,
          guildId, row.author_id, row.first_seen, row.author_name,
          ["", "", "", row.author_name, "", "", ""].join(SEPARATOR)
        ).changes;
      }
      commitTransaction(guildId);
    } catch (error) {
      rollbackTransaction(guildId);
      throw error;
    }
  }
  return seeded;
};

/**
 * enrich는 저장 구간을 무시하고 전량 재순회하므로, 완료한 서버를 다시 돌리지 않도록 표시를 남긴다.
 * 중간에 중단되면 표시가 없으므로 다음 기동에 다시 돕니다.
 */
export const isGuildEnriched = (guildId: string) =>
  Boolean(sql(guildId, "SELECT 1 FROM enrichment_state WHERE guild_id = ?", guildId));

export const markGuildEnriched = (guildId: string, messageCount: number) =>
  run(guildId, `INSERT INTO enrichment_state (guild_id, enriched_at, message_count) VALUES (?, ?, ?)
    ON CONFLICT (guild_id) DO UPDATE SET enriched_at = excluded.enriched_at, message_count = excluded.message_count`,
    guildId, Date.now(), messageCount);

/** 서버 구성원을 한 번에 읽어 현재 아바타/배너를 잡는다. Discord는 과거 프로필을 제공하지 않는다. */
export const sweepGuildProfiles = async (guild: Guild) => {
  const authorIds = all<{ author_id: Snowflake }>(
    guild.id, "SELECT DISTINCT author_id FROM discord_messages WHERE guild_id = ? LIMIT 5000", guild.id
  ).map((row) => row.author_id);
  if (authorIds.length === 0) return { scanned: 0, appended: 0, media: 0 };

  let scanned = 0;
  let appended = 0;
  let media = 0;
  for (let index = 0; index < authorIds.length; index += 1000) {
    const members = await guild.members.fetch({ user: authorIds.slice(index, index + 1000) }).catch(() => null);
    if (!members) continue;
    const pending: MediaRecord[] = [];
    for (const member of members.values()) {
      const profile = profileFromMember(member);
      if (!profile) continue;
      scanned += 1;
      const added = recordProfileSnapshot(guild.id, profile, Date.now(), "sweep");
      appended += added;
      if (added > 0) {
        const avatar = avatarMedia(profile);
        const banner = bannerMedia(profile);
        if (avatar) pending.push(avatar);
        if (banner) pending.push(banner);
      }
    }
    media += recordMediaRows(guild.id, null, pending);
  }
  console.log(`Profile sweep for ${guild.name} (${guild.id}): ${scanned} members, ${appended} new identities, ${media} media queued`);
  return { scanned, appended, media };
};
