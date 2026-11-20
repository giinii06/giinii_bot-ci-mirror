import {
  Client, Events, GatewayIntentBits, Partials,
  type ButtonInteraction, type ChatInputCommandInteraction
} from "discord.js";
import { createActivityGraphService } from "./activity-graph.js";
import { createDiscordActivityAuth } from "./activity-discord.js";
import { startActivityWebServer } from "./activity-web-server.js";
import { ensureBackfillStarted, persistLiveMessage, startInitialBackfill } from "./analysis.js";
import { ADMIN_USER_ID, handleAdminCommand } from "./admin-commands.js";
import { isAllowedGuild, isCommandEnabled, isRouletteGuild } from "./command-rules.js";
import { initializeVoiceSessions, handleVoiceStateUpdate, startVoiceTracker } from "./activity.js";
import { commandScopeCounts, rouletteCommandNames, syncCommands } from "./commands.js";
import { handlePrefixCommand } from "./prefix-commands.js";
import { config } from "./config.js";
import { handleDunkCommand, handleDunkVoiceUpdate } from "./dunk-detection.js";
import { createNoticeEmbed } from "./embeds.js";
import { startMediaWorker } from "./media.js";
import { startSeedWorker } from "./seed.js";
import { seedProfileHistoryFromMessages, sweepGuildProfiles } from "./records.js";
import { handleRouletteCommand } from "./roulette.js";
import { initDatabase } from "./storage.js";
import { handleStatisticsCommand, handleVoiceAffinityCommand, handleVoiceAffinityComponent, handleVoiceVolumeCommand } from "./voice-affinity-command.js";
import { handleVoiceAffinityGraph3dCommand, handleVoiceAffinityGraphCommand } from "./voice-affinity-graph-command.js";
import { initChat, handleChatMessage } from "./chat/index.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

const replyInteractionError = (interaction: ChatInputCommandInteraction | ButtonInteraction, error: unknown) => {
  console.error(error);
  const reply = "처리 중 오류가 발생했습니다.";
  if (interaction.deferred) void interaction.editReply(reply).catch(() => undefined);
  else if (!interaction.replied) void interaction.reply({ ephemeral: true, content: reply }).catch(() => undefined);
};

/**
 * 3D 친밀도 그래프용 HTTP 표면. 봇 프로세스가 SQLite 연결을 공유하므로
 * 컨테이너를 늘리지 않고 같은 Bun 런타임에서 정적 파일과 JSON만 내보낸다.
 */
const startActivityServer = (readyClient: Client) => {
  const { enabled, clientId, clientSecret, hostname, port, distDir } = config.activity;
  if (!enabled) return;
  if (!clientId || !clientSecret) {
    console.warn("DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET is empty; /친밀도그래프3d will stay disabled");
    return;
  }
  const graph = createActivityGraphService(readyClient);
  const discord = createDiscordActivityAuth({ clientId, clientSecret, botToken: config.discordToken });
  try {
    const server = startActivityWebServer({
      clientId,
      discord,
      distDir,
      hostname,
      port,
      snapshot: async (guildId, period) => (await graph.snapshot(guildId, period))?.snapshot ?? null,
      avatarUrl: (guildId, userId) => graph.avatarUrl(guildId, userId),
      checkMember: async (guildId, userId) => {
        const guild = readyClient.guilds.cache.get(guildId);
        if (!guild) return false;
        return Boolean(await guild.members.fetch({ user: userId, force: true }).catch(() => null));
      },
      commandEnabled: (guildId) => isCommandEnabled(guildId, "친밀도그래프3d"),
    });
    console.log(`Activity web server listening on ${hostname}:${server.port}`);
  } catch (error) {
    console.error("Activity web server failed to start", error);
  }
};

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  const guildIds = [...readyClient.guilds.cache.keys()];
  initDatabase(guildIds);
  startActivityServer(readyClient);
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
    if (await handleDunkCommand(message)) return;
    if (await handlePrefixCommand(message)) return;
    if (!message.author.bot && message.content === "!sync") {
      if (message.author.id !== ADMIN_USER_ID) return;
      void message.reply(`전역 명령 ${commandScopeCounts.global}개와 전용 서버 명령 ${commandScopeCounts.dedicated}개를 동기화합니다. 완료되면 알려줄게요.`);
      const followUp = (text: string) => message.channel.send(text).catch(() => undefined);
      syncCommands(client)
        .then(() => {
          void followUp(`전역 명령 ${commandScopeCounts.global}개와 전용 서버 명령 ${commandScopeCounts.dedicated}개를 동기화했습니다. 일반 명령어는 전역, 룰렛과 대화 명령은 전용 서버에서 사용할 수 있어요.`);
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

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  void handleVoiceStateUpdate(newState).catch((error) => console.error("Voice activity update failed", error));
  try {
    handleDunkVoiceUpdate(oldState, newState);
  } catch (error) {
    console.error("Dunk detection failed", error);
  }
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.inCachedGuild() && !isCommandEnabled(interaction.guildId, interaction.commandName)) {
      void interaction.reply({ embeds: [createNoticeEmbed("이 서버에서는 비활성화된 명령어예요",
        `/${interaction.commandName} 명령어는 이 서버에서 꺼져 있습니다. 다른 서버에서는 쓸 수 있어요.`)], ephemeral: true });
      return;
    }
    if (interaction.commandName === "친밀도그래프3d") {
      void handleVoiceAffinityGraph3dCommand(interaction).catch((error) => replyInteractionError(interaction, error));
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
        // 룰렛 명령은 전용 길드에서만 실행. DB on/off와 AND 조건이며, 하드코딩이 우선한다.
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
    void handleVoiceAffinityComponent(interaction).catch((error) => replyInteractionError(interaction, error));
  }
});

void client.login(config.discordToken);
