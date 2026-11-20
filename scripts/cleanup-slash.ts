import {
  Client, Events, GatewayIntentBits,
  type ApplicationCommandManager
} from "discord.js";
import { config } from "../src/config.js";

export const retiredSlashNames: ReadonlySet<string> = new Set([
  "model", "reasoning", "mind", "memory", "shared-memory", "타겟", "관리자_타겟"
]);

/** 제거 대상만 개별 삭제: Activity Entry Point와 나머지 명령어는 보존한다. */
export const removeRetiredCommands = async (
  manager: Pick<ApplicationCommandManager, "fetch">,
  scope: string,
  dryRun = false
): Promise<number> => {
  const all = await manager.fetch();
  const matches = [...all.values()].filter((command) => retiredSlashNames.has(command.name));
  for (const command of matches) {
    console.log(`${dryRun ? "[dry-run] " : ""}${scope}: ${command.name}`);
    if (!dryRun) await command.delete();
  }
  return matches.length;
};

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });
  try {
    await client.login(config.discordToken);
    await ready;
    if (!client.application) throw new Error("Discord application is not available");
    let count = await removeRetiredCommands(client.application.commands, "global", dryRun);
    for (const guild of client.guilds.cache.values()) {
      count += await removeRetiredCommands(guild.commands, guild.name, dryRun);
    }
    console.log(`${dryRun ? "삭제 예정" : "삭제 완료"}: ${count}개 (다시 실행해도 안전)`);
  } catch (error) {
    console.error("슬래시 명령어 정리에 실패했습니다.", error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
}
