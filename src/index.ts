import {
  Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits,
  type ButtonInteraction, type ChatInputCommandInteraction
} from "discord.js";
import { analysisCommandNames, ensureBackfillStarted, handleAnalysisCommand, persistLiveMessage, startInitialBackfill } from "./analysis.js";
import { handleAdminCommand } from "./admin-commands.js";
import { isCommandEnabled } from "./command-rules.js";
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
import { startWebServer } from "./web.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent],
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
  initializeVoiceSessions(readyClient);
  startVoiceTracker(readyClient);
  startWebServer(readyClient);
  await startMediaWorker(guildIds);
  startSeedWorker(guildIds);
  console.log(`Using ${config.aiProvider} model: ${config.aiModel}`);
  console.log(`Seeding profile history from stored messages: ${seedProfileHistoryFromMessages()} rows`);
  void startInitialBackfill(readyClient).catch((error) => console.error("Initial backfill failed", error));
  void sweepAllGuildProfiles(readyClient).catch((error) => console.error("Profile sweep failed", error));
});

const sweepAllGuildProfiles = async (client: Client) => {
  const guilds = config.guildId
    ? [await client.guilds.fetch(config.guildId).catch(() => null)]
    : [...client.guilds.cache.values()];
  for (const guild of guilds) {
    if (!guild) continue;
    await sweepGuildProfiles(guild).catch((error) => console.error(`Profile sweep failed for ${guild.id}`, error));
  }
};

client.on(Events.GuildCreate, (guild) => {
  void ensureBackfillStarted(guild);
  void syncCommands(client).catch((error) => console.error("Guild command sync failed", error));
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (await handleAdminCommand(message, client)) return;
  if (!message.author.bot && message.content === "!sync") {
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    void message.reply(`${commands.length}개 명령어를 등록합니다. 완료되면 알려줄게요.`);
    const followUp = (text: string) => message.channel.send(text).catch(() => undefined);
    syncCommands(client)
      .then(() => {
        void followUp(`${commands.length}개 명령어를 서버에 등록했습니다.`);
        console.log("!sync: done");
      })
      .catch((error) => {
        console.error("Slash command sync failed", error);
        void followUp("명령어 동기화에 실패했습니다. 봇 권한과 콘솔 오류를 확인하세요.");
      });
    return;
  }
  await persistLiveMessage(message);
});

client.on(Events.VoiceStateUpdate, (_, newState) => {
  void handleVoiceStateUpdate(newState).catch((error) => console.error("Voice activity update failed", error));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.inCachedGuild() && !isCommandEnabled(interaction.guildId, interaction.commandName)) {
      void interaction.reply({ embeds: [createNoticeEmbed("이 서버에서는 비활성화된 명령어예요",
        `/${interaction.commandName} 명령어는 이 서버에서 꺼져 있습니다. 다른 서버에서는 쓸 수 있어요.`)], ephemeral: true });
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
    if (analysisCommandNames.has(interaction.commandName)) {
      void handleAnalysisCommand(interaction).catch((error) => replyInteractionError(interaction, error));
      return;
    }
    if (interaction.inGuild()) {
      const guild = interaction.guild;
      if (guild && rouletteCommandNames.has(interaction.commandName)) {
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
