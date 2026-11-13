import {
  Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits,
  type ButtonInteraction, type ChatInputCommandInteraction
} from "discord.js";
import { ensureBackfillStarted, persistLiveMessage, startInitialBackfill } from "./analysis.js";
import { handleAdminCommand } from "./admin-commands.js";
import { isAllowedGuild, isCommandEnabled, isRouletteGuild } from "./command-rules.js";
import { initializeVoiceSessions, handleVoiceStateUpdate, startVoiceTracker } from "./activity.js";
import { commands, syncCommands } from "./commands.js";
import { config } from "./config.js";
import { createNoticeEmbed } from "./embeds.js";
import { startMediaWorker } from "./media.js";
import { startSeedWorker } from "./seed.js";
import { seedProfileHistoryFromMessages, sweepGuildProfiles } from "./records.js";
import { handleRouletteCommand } from "./roulette.js";
import { initDatabase } from "./storage.js";
import { handleStatisticsCommand, handleVoiceAffinityCommand, handleVoiceAffinityComponent, handleVoiceVolumeCommand } from "./voice-affinity-command.js";
import { handleVoiceAffinityGraphCommand } from "./voice-affinity-graph-command.js";
import { initChat, handleChatMessage, chatRouter } from "./chat/index.js";
import {
  handleModelAutocomplete, handleModelCommand, handleReasoningAutocomplete, handleReasoningCommand
} from "./chat/commands.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

const rouletteCommandNames = new Set([
  "타겟", "관리자_타겟", "관리자머리끄댕이", "관리자머리끄댕이방어권_역할"
]);

const replyInteractionError = (interaction: ChatInputCommandInteraction, error: unknown) => {
  console.error(error);
  const reply = "처리 중 오류가 발생했습니다.";
  if (interaction.deferred) void interaction.editReply(reply).catch(() => undefined);
  else if (!interaction.replied) void interaction.reply({ ephemeral: true, content: reply }).catch(() => undefined);
};

const replyButtonError = (interaction: ButtonInteraction, error: unknown) => {
  console.error(error);
  const reply = "처리 중 오류가 발생했습니다.";
  if (interaction.deferred) void interaction.editReply(reply).catch(() => undefined);
  else if (!interaction.replied) void interaction.reply({ ephemeral: true, content: reply }).catch(() => undefined);
};

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  const guildIds = [...readyClient.guilds.cache.keys()];
  initDatabase(guildIds);
  void syncCommands(client).catch((error) => console.error("Slash command sync failed", error));
  await initChat(readyClient);
  initializeVoiceSessions(readyClient);
  startVoiceTracker(readyClient);
  await startMediaWorker(() => [...readyClient.guilds.cache.keys()]);
  startSeedWorker(() => [...readyClient.guilds.cache.keys()]);
  console.log(`Seeding profile history from stored messages: ${seedProfileHistoryFromMessages()} rows`);
  void startInitialBackfill(readyClient).catch((error) => console.error("Initial backfill failed", error));
  void sweepAllGuildProfiles(readyClient).catch((error) => console.error("Profile sweep failed", error));
});

const sweepAllGuildProfiles = async (client: Client) => {
  // 멀티 서버 모드: DISCORD_GUILD_ID 로 필터하지 않고 모든 서버를 순회한다.
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    if (!guild) continue;
    await sweepGuildProfiles(guild).catch((error) => console.error(`Profile sweep failed for ${guild.id}`, error));
  }
};

client.on(Events.GuildCreate, (guild) => {
  // 늦게 초대된 서버도 즉시 초기화: DB + 슬래시 명령 + 백필.
  // media/seed 워커는 live guild 목록을 매 tick 읽으므로 별도 notify 없이 다음 tick 부터 처리된다.
  initDatabase([guild.id]);
  void ensureBackfillStarted(guild).catch((error) => console.error(`Backfill failed for new guild ${guild.id}`, error));
  void syncCommands(client, guild).catch((error) => console.error("Guild command sync failed", error));
});

client.on(Events.MessageCreate, async (message) => {
  if (message.inGuild()) {
    if (await handleAdminCommand(message, client)) return;
    if (!message.author.bot && message.content === "!sync") {
      if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
      void message.reply(`${commands.length}개 명령어를 전역·전용 서버 범위에 동기화합니다. 완료되면 알려줄게요.`);
      const followUp = (text: string) => message.channel.send(text).catch(() => undefined);
      syncCommands(client)
        .then(() => {
          void followUp(`${commands.length}개 명령어를 동기화했습니다. 일반 명령어는 전역, 룰렛은 전용 서버에서 사용할 수 있어요.`);
          console.log("!sync: done");
        })
        .catch((error) => {
          console.error("Slash command sync failed", error);
          void followUp("명령어 동기화에 실패했습니다. 봇 권한과 콘솔 오류를 확인하세요.");
        });
      return;
    }
    await persistLiveMessage(message);
  }
  await handleChatMessage(message);
});

client.on(Events.VoiceStateUpdate, (_, newState) => {
  void handleVoiceStateUpdate(newState).catch((error) => console.error("Voice activity update failed", error));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isAutocomplete()) {
    const router = chatRouter();
    if (!router || !isAllowedGuild(interaction.guildId)) {
      void interaction.respond([]).catch(() => undefined);
      return;
    }
    if (interaction.commandName === "model") {
      void handleModelAutocomplete(interaction, router).catch((error) => console.error("Model autocomplete failed", error));
      return;
    }
    if (interaction.commandName === "reasoning") {
      void handleReasoningAutocomplete(interaction, router).catch((error) => console.error("Reasoning autocomplete failed", error));
    }
    return;
  }
  if (interaction.isChatInputCommand()) {
    if (interaction.inCachedGuild() && !isCommandEnabled(interaction.guildId, interaction.commandName)) {
      void interaction.reply({ embeds: [createNoticeEmbed("이 서버에서는 비활성화된 명령어예요",
        `/${interaction.commandName} 명령어는 이 서버에서 꺼져 있습니다. 다른 서버에서는 쓸 수 있어요.`)], ephemeral: true });
      return;
    }
    if (interaction.commandName === "model" || interaction.commandName === "reasoning") {
      if (!interaction.inCachedGuild() || !isAllowedGuild(interaction.guildId)) {
        void interaction.reply({ ephemeral: true, content: "기니봇아 대화는 지정된 서버에서만 쓸 수 있습니다." }).catch(() => undefined);
        return;
      }
      const router = chatRouter();
      if (!router) {
        void interaction.reply({ ephemeral: true, content: "OPENROUTER_API_KEY가 비어 있어 기니봇아 대화 기능이 꺼져 있습니다." }).catch(() => undefined);
        return;
      }
      const run = interaction.commandName === "model"
        ? handleModelCommand(interaction, router)
        : handleReasoningCommand(interaction, router);
      void run.catch((error) => replyInteractionError(interaction, error));
      return;
    }
    if (interaction.commandName === "친밀도그래프") {
      void handleVoiceAffinityGraphCommand(interaction).catch((error) => replyInteractionError(interaction, error));
      return;
    }
    if (interaction.commandName === "친밀도") {
      void handleVoiceAffinityCommand(interaction).catch((error) => replyInteractionError(interaction, error));
      return;
    }
    if (interaction.commandName === "통화량") {
      void handleVoiceVolumeCommand(interaction).catch((error) => replyInteractionError(interaction, error));
      return;
    }
    if (interaction.commandName === "통계") {
      void handleStatisticsCommand(interaction).catch((error) => replyInteractionError(interaction, error));
      return;
    }
    if (interaction.inGuild()) {
      const guild = interaction.guild;
      if (guild && rouletteCommandNames.has(interaction.commandName)) {
        // 룰렛 4종은 전용 길드에서만 실행. DB on/off와 AND 조건이며, 하드코딩이 우선한다.
        if (!isRouletteGuild(interaction.guildId)) {
          void interaction.reply({ embeds: [createNoticeEmbed("이 서버에서는 비활성화된 명령어예요",
            `/${interaction.commandName} 명령어는 지정된 서버에서만 쓸 수 있어요.`)], ephemeral: true });
          return;
        }
        void handleRouletteCommand(interaction, guild).catch((error) => replyInteractionError(interaction, error));
        return;
      }
    }
  }
  if (interaction.isButton() && interaction.customId.startsWith("voice-affinity:")) {
    void handleVoiceAffinityComponent(interaction).catch((error) => replyButtonError(interaction, error));
  }
});

void client.login(config.discordToken);
