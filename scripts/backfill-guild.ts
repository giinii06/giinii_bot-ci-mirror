import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { backfillGuildOnce } from "../src/analysis.js";
import { config } from "../src/config.js";
import { sql } from "../src/storage.js";

/**
 * 서버 하나만 일회성으로 백필한다. 봇이 이미 실시간 수집 중이어도 안전하다
 * (저장은 message_id 기준 upsert라 중복이 생기지 않는다).
 *
 *   bun run scripts/backfill-guild.ts <서버ID>
 */
const guildId = process.argv[2]?.trim() ?? "";
if (!/^\d{15,25}$/.test(guildId)) {
  console.error("usage: bun run scripts/backfill-guild.ts <guildId>");
  process.exit(2);
}

const storedCount = () =>
  sql<{ stored: number }>(guildId, "SELECT COUNT(*) AS stored FROM discord_messages WHERE guild_id = ?", guildId)?.stored ?? 0;

const before = storedCount();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message]
});

let exitCode = 1;

client.once(Events.ClientReady, () => {
  void (async () => {
    try {
      const guild = await client.guilds.fetch(guildId);
      console.log(`Backfilling ${guild.name} (${guild.id}) once`);
      const status = await backfillGuildOnce(guild);
      console.log(`Backfill done for ${guild.name} (${guild.id}): ${status.messageCount} fetched, ${storedCount() - before} newly saved, ${storedCount()} stored total`);
      exitCode = 0;
    } catch (error) {
      console.error(`Backfill failed for ${guildId}`, error);
    } finally {
      await client.destroy();
      process.exit(exitCode);
    }
  })();
});

void client.login(config.discordToken).catch((error) => {
  console.error("Discord login failed", error);
  process.exit(1);
});
