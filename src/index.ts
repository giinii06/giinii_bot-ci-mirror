import {
  Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits, type ChatInputCommandInteraction
} from "discord.js";
import { analysisCommandNames, ensureBackfillStarted, handleAnalysisCommand, persistLiveMessage, startInitialBackfill } from "./analysis.js";
import { recordMessageActivity, initializeVoiceSessions, handleVoiceStateUpdate, startVoiceTracker } from "./activity.js";
import { commands, syncCommands } from "./commands.js";
import { config } from "./config.js";
import { handleRouletteCommand } from "./roulette.js";
import { initDatabase } from "./storage.js";
import { startWebServer } from "./web.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message]
});

const rouletteCommandNames = new Set(["타겟역할설정", "관리자역할추가", "관리자머리끄댕이"]);

const replyInteractionError = (interaction: ChatInputCommandInteraction, error: unknown) => {
  console.error(error);
  const reply = "처리 중 오류가 발생했습니다.";
  if (interaction.deferred) void interaction.editReply(reply).catch(() => undefined);
  else if (!interaction.replied) void interaction.reply({ ephemeral: true, content: reply }).catch(() => undefined);
};

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  initDatabase();
  try { await syncCommands(client); } catch (error) { console.error("Slash command sync failed", error); }
  initializeVoiceSessions(client);
  startVoiceTracker(client);
  startWebServer();
  console.log(`Using ${config.aiProvider} model: ${config.aiModel}`);
  void startInitialBackfill(client).catch((error) => console.error("Initial backfill failed", error));
});

client.on(Events.GuildCreate, (guild) => {
  void ensureBackfillStarted(guild);
  void syncCommands(client).catch((error) => console.error("Guild command sync failed", error));
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (!message.author.bot && message.content === "!sync") {
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    try {
      await syncCommands(client);
      await message.reply(`${commands.length}개 명령어를 서버에 등록했습니다.`);
    } catch (error) {
      console.error(error);
      await message.reply("명령어 동기화에 실패했습니다. 봇 권한과 콘솔 오류를 확인하세요.");
    }
    return;
  }
  recordMessageActivity(message);
  await persistLiveMessage(message);
});

client.on(Events.VoiceStateUpdate, (_, newState) => {
  void handleVoiceStateUpdate(newState).catch((error) => console.error("Voice activity update failed", error));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand()) {
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
});

void client.login(config.discordToken);
