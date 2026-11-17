import { expect, test } from "bun:test";
import {
  MEMBER_CACHE_TTL_MS, resolveVoiceGraphMembers, type MemberCache,
} from "../src/voice-graph-members.js";

const guildStub = () => {
  let calls = 0;
  const guild = {
    id: "g1",
    members: {
      fetch: async (userId: string) => {
        calls += 1;
        return {
          displayName: `이름${userId}`,
          displayAvatarURL: () => `https://cdn.test/${userId}.png`,
        };
      },
    },
  };
  return { guild, calls: () => calls };
};

const clientStub = { users: { fetch: async () => null } };

test("reuses resolved members until the cache expires", async () => {
  const { guild, calls } = guildStub();
  const cache: MemberCache = new Map();
  const now = 1_000_000;

  const first = await resolveVoiceGraphMembers(guild as never, clientStub as never, ["222", "111"], cache, now);
  expect(first.map((member) => member.name)).toEqual(["이름222", "이름111"]);
  expect(calls()).toBe(2);

  const second = await resolveVoiceGraphMembers(guild as never, clientStub as never, ["222", "111"], cache, now + 1_000);
  expect(second.map((member) => member.name)).toEqual(["이름222", "이름111"]);
  expect(calls()).toBe(2);

  await resolveVoiceGraphMembers(guild as never, clientStub as never, ["222", "111"], cache, now + MEMBER_CACHE_TTL_MS + 1);
  expect(calls()).toBe(4);
});

test("fetches only the users missing from the cache", async () => {
  const { guild, calls } = guildStub();
  const cache: MemberCache = new Map();

  await resolveVoiceGraphMembers(guild as never, clientStub as never, ["111"], cache, 1_000_000);
  expect(calls()).toBe(1);

  const both = await resolveVoiceGraphMembers(guild as never, clientStub as never, ["111", "222"], cache, 1_000_001);
  expect(both.map((member) => member.userId)).toEqual(["111", "222"]);
  expect(calls()).toBe(2);
});

test("keeps working without a cache", async () => {
  const { guild, calls } = guildStub();

  await resolveVoiceGraphMembers(guild as never, clientStub as never, ["111"], undefined, 1_000_000);
  await resolveVoiceGraphMembers(guild as never, clientStub as never, ["111"], undefined, 1_000_001);
  expect(calls()).toBe(2);
});
