import { AttachmentBuilder, type ChatInputCommandInteraction, type Client, type Guild, type Message, type User } from "discord.js";
import { ensureChatStatsMigrated, ensureGuildChatStats, markChatStatsCurrent, recordChatCounts } from "./activity.js";
import { config, MAX_HISTORY_MESSAGE_LIMIT } from "./config.js";
import { createNoticeEmbed, createProgressEmbed, createResultEmbed } from "./embeds.js";
import { askGemini, buildDebugPromptText } from "./gemini.js";
import { recordMessageRecords, isGuildEnriched, markGuildEnriched } from "./records.js";
import { cleanMessage, captureDetail, captureMedia, captureProfile, collectDiscordHistoryInBatches, collectHistory, safeCapture, type HistoryMessage, type MediaRecord } from "./history.js";
import { fetchStoredChannelRanges, initDatabase, insertCommandLog, sql, upsertMessages } from "./storage.js";
import { splitForEmbeds } from "./text.js";

export const analysisCommandNames = new Set(["question", "mbti", "결투", "계급", "싸이코지수", "별명", "흑역사", "요약", "캐릭터"]);
const runningGuilds = new Set<string>();
const cooldowns = new Map<string, number>();
const backfillStatuses = new Map<string, BackfillStatus>();
const debugGuilds = new Set<string>();
const INITIAL_BACKFILL_BATCH_SIZE = 100;

type BackfillStatus = { state: "running" | "ready" | "error"; messageCount: number; startedAt: number; completedAt?: number; error?: string };
type AnalysisRequest = {
  prompt: string; input: string; title: string; progressLabel: string; titlePrefix: string; channels?: string | null; limit?: number | null;
};

const withCommonPrompt = (commandPrompt: string) => [config.commonPrompt, commandPrompt].filter(Boolean).join("\n\n");
const formatUserForPrompt = (user: User) => `${user.displayName || user.username} (@${user.username}, id: ${user.id})`;
const formatUserForTitle = (user: User) => user.displayName || user.username;

const buildAnalysisRequest = (interaction: ChatInputCommandInteraction): AnalysisRequest => {
  const name = interaction.commandName;
  if (name === "question") {
    const question = interaction.options.getString("question", true);
    return { prompt: withCommonPrompt(config.questionPrompt), input: question, title: question, progressLabel: "질문 분석", titlePrefix: "질문",
      channels: interaction.options.getString("channels"), limit: interaction.options.getInteger("limit") };
  }
  if (name === "mbti") {
    const user = interaction.options.getUser("user", true);
    return { prompt: withCommonPrompt(config.mbtiPrompt), input: ["다음 유저의 최근 대화 패턴을 근거로 MBTI를 논리적으로 추정해줘.", `대상 유저: ${formatUserForPrompt(user)}`].join("\n"),
      title: `MBTI ${formatUserForTitle(user)}`, progressLabel: "MBTI 분석", titlePrefix: "MBTI" };
  }
  if (name === "결투") {
    const user1 = interaction.options.getUser("user1", true);
    const user2 = interaction.options.getUser("user2", true);
    return { prompt: withCommonPrompt(config.duelPrompt), input: ["다음 두 유저가 말로 싸우면 누가 이길지, 이긴다면 몇 퍼센트 확률로 이길지 분석해줘.",
      `유저 1: ${formatUserForPrompt(user1)}`, `유저 2: ${formatUserForPrompt(user2)}`].join("\n"),
      title: `${formatUserForTitle(user1)} vs ${formatUserForTitle(user2)}`, progressLabel: "결투 분석", titlePrefix: "결투" };
  }
  if (name === "계급") return { prompt: withCommonPrompt(config.rankPrompt), input: "최근 디스코드 대화 기록에 등장하는 유저들 간의 관계와 영향력을 분석해서 신, 왕, 귀족, 하인, 불가촉 천민 계급으로 나눠서 지명해줘.",
    title: "서버 계급 분석", progressLabel: "계급 분석", titlePrefix: "계급" };
  if (name === "싸이코지수") {
    const user = interaction.options.getUser("user", true);
    return { prompt: withCommonPrompt(config.psychoPrompt), input: ["다음 유저의 싸이코 지수를 1점부터 100점까지 측정해줘.", `대상 유저: ${formatUserForPrompt(user)}`].join("\n"),
      title: `싸이코 지수 ${formatUserForTitle(user)}`, progressLabel: "싸이코 지수 분석", titlePrefix: "싸이코" };
  }
  if (name === "별명") {
    const user = interaction.options.getUser("user", true);
    return { prompt: withCommonPrompt(config.nicknamePrompt), input: ["다음 유저에게 최근 대화 패턴을 근거로 서버에서 쓸 만한 별명을 지어줘.", `대상 유저: ${formatUserForPrompt(user)}`].join("\n"),
      title: `별명 ${formatUserForTitle(user)}`, progressLabel: "별명 작명", titlePrefix: "별명" };
  }
  if (name === "흑역사") {
    const user = interaction.options.getUser("user", true);
    return { prompt: withCommonPrompt(config.throwbackPrompt), input: ["다음 유저의 장난스러운 흑역사 포인트를 최근 대화 기록에서 찾아줘.", `대상 유저: ${formatUserForPrompt(user)}`].join("\n"),
      title: `흑역사 ${formatUserForTitle(user)}`, progressLabel: "흑역사 분석", titlePrefix: "흑역사" };
  }
  if (name === "요약") return { prompt: withCommonPrompt(config.summaryPrompt), input: "최근 서버 대화 기록을 바탕으로 주요 사건, 분위기, 눈에 띄는 흐름을 재밌게 요약해줘.",
    title: "서버 요약", progressLabel: "서버 요약", titlePrefix: "요약" };
  if (name === "캐릭터") {
    const user = interaction.options.getUser("user", true);
    return { prompt: withCommonPrompt(config.characterPrompt), input: ["다음 유저의 최근 대화 패턴을 근거로 RPG 캐릭터 시트를 만들어줘.", `대상 유저: ${formatUserForPrompt(user)}`].join("\n"),
      title: `캐릭터 ${formatUserForTitle(user)}`, progressLabel: "캐릭터 생성", titlePrefix: "캐릭터" };
  }
  throw new Error(`지원하지 않는 명령어입니다: ${name}`);
};

export type PlaygroundInput = {
  command: string;
  question?: string;
  targetUser?: string;
  user1?: string;
  user2?: string;
};

const requiredPlaygroundValue = (value: string | undefined, label: string) => {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label}을(를) 입력해 주세요.`);
  return trimmed;
};

export const buildPlaygroundRequest = (values: PlaygroundInput): Pick<AnalysisRequest, "prompt" | "input"> => {
  if (!analysisCommandNames.has(values.command)) throw new Error("채팅 분석 명령어만 테스트할 수 있어요.");
  if (values.command === "question") return {
    prompt: withCommonPrompt(config.questionPrompt),
    input: requiredPlaygroundValue(values.question, "질문")
  };
  if (values.command === "mbti") return {
    prompt: withCommonPrompt(config.mbtiPrompt),
    input: ["다음 유저의 최근 대화 패턴을 근거로 MBTI를 논리적으로 추정해줘.", `대상 유저: ${requiredPlaygroundValue(values.targetUser, "대상 유저")}`].join("\n")
  };
  if (values.command === "결투") return {
    prompt: withCommonPrompt(config.duelPrompt),
    input: ["다음 두 유저가 말로 싸우면 누가 이길지, 이긴다면 몇 퍼센트 확률로 이길지 분석해줘.",
      `유저 1: ${requiredPlaygroundValue(values.user1, "유저 1")}`, `유저 2: ${requiredPlaygroundValue(values.user2, "유저 2")}`].join("\n")
  };
  if (values.command === "계급") return {
    prompt: withCommonPrompt(config.rankPrompt),
    input: "최근 디스코드 대화 기록에 등장하는 유저들 간의 관계와 영향력을 분석해서 신, 왕, 귀족, 하인, 불가촉 천민 계급으로 나눠서 지명해줘."
  };
  if (values.command === "싸이코지수") return {
    prompt: withCommonPrompt(config.psychoPrompt),
    input: ["다음 유저의 싸이코 지수를 1점부터 100점까지 측정해줘.", `대상 유저: ${requiredPlaygroundValue(values.targetUser, "대상 유저")}`].join("\n")
  };
  if (values.command === "별명") return {
    prompt: withCommonPrompt(config.nicknamePrompt),
    input: ["다음 유저에게 최근 대화 패턴을 근거로 서버에서 쓸 만한 별명을 지어줘.", `대상 유저: ${requiredPlaygroundValue(values.targetUser, "대상 유저")}`].join("\n")
  };
  if (values.command === "흑역사") return {
    prompt: withCommonPrompt(config.throwbackPrompt),
    input: ["다음 유저의 장난스러운 흑역사 포인트를 최근 대화 기록에서 찾아줘.", `대상 유저: ${requiredPlaygroundValue(values.targetUser, "대상 유저")}`].join("\n")
  };
  if (values.command === "요약") return {
    prompt: withCommonPrompt(config.summaryPrompt),
    input: "최근 서버 대화 기록을 바탕으로 주요 사건, 분위기, 눈에 띄는 흐름을 재밌게 요약해줘."
  };
  return {
    prompt: withCommonPrompt(config.characterPrompt),
    input: ["다음 유저의 최근 대화 패턴을 근거로 RPG 캐릭터 시트를 만들어줘.", `대상 유저: ${requiredPlaygroundValue(values.targetUser, "대상 유저")}`].join("\n")
  };
};

export const handleAnalysisCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ embeds: [createNoticeEmbed("서버에서만 사용할 수 있어요", "이 명령어는 DM이 아니라 디스코드 서버 채널에서 실행해 주세요.")], ephemeral: true });
    return;
  }
  const guildId = interaction.guildId;
  const backfillStatus = backfillStatuses.get(guildId);
  if (backfillStatus?.state !== "ready") {
    if (!backfillStatus) void ensureBackfillStarted(interaction.guild);
    const description = backfillStatus?.state === "error"
      ? `초기 채팅 기록 백필 중 오류가 났어요. 봇 로그를 확인해 주세요.\n\`${backfillStatus.error?.slice(0, 800) ?? "알 수 없는 오류"}\``
      : "서버의 전체 채팅 기록을 저장하는 중입니다. 백필이 끝난 뒤 다시 시도해 주세요.";
    await interaction.reply({ embeds: [createNoticeEmbed("아직 준비 중이에요", description)], ephemeral: true });
    return;
  }

  const cooldownKey = `${guildId}:${interaction.user.id}`;
  const now = Date.now();
  const cooldownUntil = cooldowns.get(cooldownKey) ?? 0;
  if (now < cooldownUntil) {
    await interaction.reply({ embeds: [createNoticeEmbed("잠깐만요", `너무 빠르게 요청하고 있어요. \`${Math.ceil((cooldownUntil - now) / 1000)}s\` 뒤에 다시 시도해 주세요.`)], ephemeral: true });
    return;
  }
  if (runningGuilds.has(guildId)) {
    await interaction.reply({ embeds: [createNoticeEmbed("이미 처리 중이에요", "이 서버에서 다른 분석 요청이 실행 중입니다. 끝난 뒤 다시 시도해 주세요.")], ephemeral: true });
    return;
  }

  const request = buildAnalysisRequest(interaction);
  const limit = Math.min(Math.max(request.limit ?? config.historyMessageLimit, 1), MAX_HISTORY_MESSAGE_LIMIT);
  let startedAt = Date.now();
  let seconds = 0;
  let progressLabel = request.progressLabel;
  let failedProvider = config.aiProvider;
  let failedModel = config.aiModel;
  let progressTimer: ReturnType<typeof setInterval> | undefined;
  runningGuilds.add(guildId);
  cooldowns.set(cooldownKey, now + config.cooldownSeconds * 1000);

  try {
    await interaction.reply({ embeds: [createProgressEmbed(seconds, limit, false, request.title, request.progressLabel, request.titlePrefix)] });
    const progressMessage = await interaction.fetchReply();
    progressTimer = setInterval(() => {
      seconds = Math.floor((Date.now() - startedAt) / 1000);
      void progressMessage.edit({ embeds: [createProgressEmbed(seconds, limit, false, request.title, progressLabel, request.titlePrefix)] }).catch(() => undefined);
    }, 1_000);
    const history = await collectHistory(interaction.guild, limit, request.channels);
    if (history.messageCount === 0) {
      await interaction.editReply({ embeds: [createNoticeEmbed("읽을 수 있는 기록이 없어요", "저장된 채팅 기록이 아직 없어요. 봇 권한과 초기 백필 로그를 확인해 주세요.")] });
      return;
    }
    const author = { displayName: interaction.member?.displayName || interaction.user.displayName || interaction.user.username,
      username: interaction.user.username, userId: interaction.user.id };
    if (debugGuilds.has(guildId)) await interaction.followUp({ content: "디버그 모드: LLM 호출 전에 전달할 프롬프트입니다.", files: [
      new AttachmentBuilder(Buffer.from(buildDebugPromptText(request.input, history.text, author, request.prompt), "utf8"), { name: "llm-prompt-debug.txt" })
    ] });
    const answer = await askGemini(request.input, history.text, author, request.prompt, {
      onRetry: async () => {
        progressLabel = "재시도";
        seconds = Math.floor((Date.now() - startedAt) / 1000);
        await progressMessage.edit({ embeds: [createProgressEmbed(seconds, limit, false, request.title, progressLabel, request.titlePrefix)] }).catch(() => undefined);
      },
      onFallback: async () => {
        failedProvider = config.fallbackProvider;
        failedModel = config.fallbackModel;
        startedAt = Date.now();
        seconds = 0;
        progressLabel = "다시 호출합니다!";
        await progressMessage.edit({ embeds: [createProgressEmbed(seconds, limit, false, request.title, progressLabel, request.titlePrefix)] }).catch(() => undefined);
      }
    });
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    try {
      insertCommandLog(guildId, { channelId: interaction.channelId, userId: interaction.user.id, userName: author.displayName,
        commandName: interaction.commandName, question: request.input, provider: config.aiProvider, model: config.aiModel, output: answer });
    } catch (error) { console.error("Failed to persist command log", error); }
    if (progressTimer) clearInterval(progressTimer);
    await progressMessage.edit({ embeds: [createProgressEmbed(elapsedSeconds, limit, true, request.title, request.progressLabel, request.titlePrefix)] });
    const pages = splitForEmbeds(answer);
    for (let index = 0; index < pages.length; index += 1) {
      await interaction.followUp({ embeds: [createResultEmbed(request.title, pages[index] ?? "", index + 1, pages.length, elapsedSeconds)] });
    }
    if (history.failedChannels > 0) await interaction.followUp({ embeds: [createNoticeEmbed("일부 채널은 건너뛰었어요",
      `권한 또는 Discord API 제한 때문에 \`${history.failedChannels}\`개 채널의 기록을 읽지 못했습니다. 읽은 메시지: \`${history.messageCount}\`개, 채널: \`${history.channelCount}/${history.scannedChannelCount}\`개.`)], ephemeral: true });
  } catch (error) {
    if (progressTimer) clearInterval(progressTimer);
    console.error(error);
    const embed = createNoticeEmbed("처리 중 오류가 났어요", `\`${failedProvider}/${failedModel}\``, "error");
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [embed] }).catch(() => undefined);
    else await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => undefined);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    runningGuilds.delete(guildId);
  }
};

export const persistLiveMessage = async (message: Message) => {
  if (!message.inGuild()) return;
  const content = cleanMessage(message);
  if (!content) return;
  if (!message.author.bot && content.toLowerCase() === "!debug on") {
    debugGuilds.add(message.guildId);
    await message.reply({ embeds: [createNoticeEmbed("디버그 모드 ON", "LLM 호출 직전에 프롬프트를 txt 첨부로 보냅니다.")] });
    return;
  }
  if (!message.author.bot && content.toLowerCase() === "!debug off") {
    debugGuilds.delete(message.guildId);
    await message.reply({ embeds: [createNoticeEmbed("디버그 모드 OFF", "이제 LLM 프롬프트 첨부를 보내지 않습니다.")] });
    return;
  }
  const historyMessage: HistoryMessage = { messageId: message.id, guildId: message.guildId, channelId: message.channelId,
    channelName: "name" in message.channel && typeof message.channel.name === "string" ? message.channel.name : message.channelId,
    authorId: message.author.id, authorName: message.member?.displayName || message.author.displayName || message.author.username,
    authorIsBot: message.author.bot, content, createdTimestamp: message.createdTimestamp,
    profile: safeCapture("live profile", () => captureProfile(message), null),
    media: safeCapture("live media", () => captureMedia(message), [] as MediaRecord[]),
    detail: safeCapture("live detail", () => captureDetail(message), null) };
  try {
    const inserted = upsertMessages(message.guildId, [historyMessage]);
    recordChatCounts(message.guildId, inserted);
    recordMessageRecords(message.guildId, inserted);
  } catch (error) { console.error("Failed to persist live message", error); }
};

export const startInitialBackfill = async (client: Client) => {
  const guilds = config.guildId ? [await client.guilds.fetch(config.guildId)] : await Promise.all([...client.guilds.cache.values()].map((guild) => guild.fetch()));
  initDatabase(guilds.map((guild) => guild.id));
  ensureChatStatsMigrated();
  await Promise.all(guilds.map((guild) => backfillGuild(guild)));
};

const storedCount = (guildId: string) =>
  sql<{ stored: number }>(guildId, "SELECT COUNT(*) AS stored FROM discord_messages WHERE guild_id = ?", guildId)?.stored ?? 0;

const backfillGuild = async (guild: Guild) => {
  const startedAt = Date.now();
  const storedRanges = fetchStoredChannelRanges(guild.id);
  if (config.skipBackfill) {
    console.log(`Skipping backfill for ${guild.name} (${guild.id}) because SKIP_BACKFILL is set`);
    // 건너뛰어도 DB에 이미 쌓인 기록은 그대로 쓸 수 있다. 이 표시가 없으면
    // 분석 명령이 "준비 중"에서 영영 풀리지 않는다.
    markChatStatsCurrent(guild.id);
    backfillStatuses.set(guild.id, { state: "ready", messageCount: storedCount(guild.id), startedAt, completedAt: Date.now() });
    return;
  }
  try {
    ensureGuildChatStats(guild.id);
    console.log(`Backfilling ${guild.name} (${guild.id}): every readable message, ${storedRanges.size} channel(s) already saved`);
    let saved = 0;
    const history = await collectDiscordHistoryInBatches(guild, { batchSize: INITIAL_BACKFILL_BATCH_SIZE, storedRanges }, async (messages, totalCollected) => {
      const inserted = upsertMessages(guild.id, messages);
      recordChatCounts(guild.id, inserted);
      recordMessageRecords(guild.id, inserted);
      saved += inserted.length;
      backfillStatuses.set(guild.id, { state: "running", messageCount: totalCollected, startedAt });
      console.log(`Backfill progress for ${guild.name}: ${totalCollected} fetched, ${saved} newly saved`);
    });
    markChatStatsCurrent(guild.id);
    backfillStatuses.set(guild.id, { state: "ready", messageCount: history.messageCount, startedAt, completedAt: Date.now() });
    console.log(`Backfill ready for ${guild.name}: ${history.messageCount} fetched, ${saved} newly saved, ${history.scannedChannelCount} channel(s)`);
    await enrichGuildHistory(guild).catch((error) => console.error(`Enrichment failed for ${guild.name}`, error));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    backfillStatuses.set(guild.id, { state: "error", messageCount: 0, startedAt, completedAt: Date.now(), error: message });
    console.error(`Backfill failed for ${guild.name} (${guild.id})`, error);
  }
};

/**
 * 이미 저장된 구간은 백필이 건너뛰므로, 예전에 받은 메시지에는 부가 정보가 없다.
 * 저장 범위를 무시하고 전부 다시 훑어 상세/미디어/프로필 이력을 채운다. 완료하면 표시를 남긴다.
 */
const enrichGuildHistory = async (guild: Guild) => {
  if (isGuildEnriched(guild.id)) {
    console.log(`Enrichment for ${guild.name} (${guild.id}): already complete, skipping`);
    return;
  }
  const startedAt = Date.now();
  let details = 0;
  let media = 0;
  let profiles = 0;
  let batches = 0;
  const history = await collectDiscordHistoryInBatches(guild, { batchSize: INITIAL_BACKFILL_BATCH_SIZE }, async (messages, totalCollected) => {
    const recorded = recordMessageRecords(guild.id, messages);
    details += recorded.details;
    media += recorded.media;
    profiles += recorded.profiles;
    batches += 1;
    if (batches % 100 === 0) {
      console.log(`Enrichment progress for ${guild.name}: ${totalCollected} messages, ${details} details, ${media} media, ${profiles} profile rows`);
    }
  });
  markGuildEnriched(guild.id, history.messageCount);
  console.log(`Enrichment for ${guild.name} (${guild.id}): ${history.messageCount} messages revisited in ${Date.now() - startedAt}ms, ${details} details, ${media} media, ${profiles} profile rows`);
};

export const ensureBackfillStarted = async (guild: Guild) => {
  initDatabase([guild.id]);
  if (!backfillStatuses.has(guild.id)) await backfillGuild(guild);
};
