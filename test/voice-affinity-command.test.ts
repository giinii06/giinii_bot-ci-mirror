import { expect, test } from "bun:test";
import { handleVoiceAffinityComponent, sendAffinityCards } from "../src/voice-affinity-command.js";
import type { VoiceAffinity } from "../src/voice-affinity.js";

const affinities: VoiceAffinity[] = Array.from({ length: 21 }, (_, index) => ({
  user_id: `user-${index}`,
  shared_ms: (21 - index) * 60_000,
  last_together_at: 0,
}));

const loadProfile = async (userId: string) => ({ name: userId, username: userId });

const buttonStates = (edit: any) =>
  edit.components[0].components.map(({ data }: any) => [data.label, data.disabled]);

const commandInteraction = (messageId: string, edits: any[]) => ({
  user: { id: "requester" },
  editReply: async (options: any) => {
    edits.push(options);
    return { id: messageId };
  },
});

const buttonInteraction = (customId: string, messageId: string, updates: any[]) => ({
  customId,
  user: { id: "requester" },
  message: { id: messageId },
  reply: async () => undefined,
  update: async (options: any) => {
    updates.push(options);
  },
});

test("uploads the first card before the remaining pages are ready", async () => {
  const edits: any[] = [];
  await sendAffinityCards(commandInteraction("message-sequence", edits) as any, "대상", affinities, loadProfile);

  expect(edits).toHaveLength(3);
  expect(edits.map((edit) => edit.files?.length ?? 0)).toEqual([1, 0, 0]);
  expect(edits.map(buttonStates)).toEqual([
    [["◀", true], ["1 / 3", true], ["▶", true]],
    [["◀", true], ["1 / 3", true], ["▶", false]],
    [["◀", true], ["1 / 3", true], ["▶", false]],
  ]);
});

test("loads one page of profiles per card so the first upload waits for seven", async () => {
  const loaded: string[] = [];
  const edits: any[] = [];
  const interaction = commandInteraction("message-batches", edits);
  interaction.editReply = async (options: any) => {
    edits.push({ ...options, loaded: loaded.length });
    return { id: "message-batches" };
  };

  await sendAffinityCards(interaction as any, "대상", affinities, async (userId) => {
    loaded.push(userId);
    return { name: userId, username: userId };
  });

  expect(edits.map((edit) => edit.loaded)).toEqual([7, 14, 21]);
});

test("opens the forward arrow on the last page once every card is ready", async () => {
  const edits: any[] = [];
  await sendAffinityCards(commandInteraction("message-last", edits) as any, "대상", affinities, loadProfile);
  const updates: any[] = [];
  await handleVoiceAffinityComponent(buttonInteraction("voice-affinity:2", "message-last", updates) as any);

  expect(updates).toHaveLength(1);
  expect(updates[0].files).toHaveLength(1);
  expect(buttonStates(updates[0])).toEqual([["◀", false], ["3 / 3", true], ["▶", true]]);
});

test("re-enables the forward arrow on the page the viewer already opened", async () => {
  const edits: any[] = [];
  const updates: any[] = [];
  await sendAffinityCards(commandInteraction("message-viewer", edits) as any, "대상", affinities, async (userId) => {
    if (userId === "user-14") {
      await handleVoiceAffinityComponent(buttonInteraction("voice-affinity:1", "message-viewer", updates) as any);
    }
    return { name: userId, username: userId };
  });

  expect(buttonStates(updates[0])).toEqual([["◀", false], ["2 / 3", true], ["▶", true]]);
  expect(buttonStates(edits[2])).toEqual([["◀", false], ["2 / 3", true], ["▶", false]]);
});
