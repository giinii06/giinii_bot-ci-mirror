import { Database } from "bun:sqlite";
import type { Message } from "discord.js";
import { MIND_SCHEMA, ROOT_SCHEMA } from "../src/mind/schema.js";
import type {
  BotUserRelationship,
  MemoryActor,
  MemoryCandidate,
  MemoryDecision,
  MemoryRecord,
  MindContext,
  MindDecision,
  MindRequest
} from "../src/mind/types.js";

export const GUILD = "1111111111111111111";
export const OTHER_GUILD = "2222222222222222222";
export const USER = "100000000000000001";
export const OTHER = "100000000000000002";
export const ADMIN = "100000000000000003";
export const BOT = "100000000000000004";

export const mindDb = (): Database => {
  const db = new Database(":memory:");
  db.exec(MIND_SCHEMA);
  return db;
};

export const rootDb = (): Database => {
  const db = new Database(":memory:");
  db.exec(ROOT_SCHEMA);
  return db;
};

export const requestOf = (overrides: Partial<MindRequest> = {}): MindRequest => ({
  messageId: "m1",
  guildId: GUILD,
  channelId: "c1",
  userId: USER,
  displayName: "민지",
  isAdministrator: false,
  text: "기니봇아 야이 멍청아",
  trigger: "prefix",
  replyToAuthorId: null,
  botWasReplyTarget: false,
  referencedUsers: [],
  ambiguousUserNames: [],
  createdAt: 10_000,
  recent: [],
  ...overrides
});

export const relationshipOf = (
  overrides: Partial<BotUserRelationship> = {}
): BotUserRelationship => ({
  guildId: GUILD,
  userId: USER,
  familiarity: 0.5,
  rapport: 0.6,
  playfulness: 0.6,
  engagement: 0.4,
  communicationStyle: "default",
  confidence: 0.5,
  interactionCount: 10,
  positiveInteractionCount: 6,
  negativeFeedbackCount: 1,
  firstInteractionAt: 0,
  lastInteractionAt: 0,
  version: 1,
  ...overrides
});

export const memoryDecisionOf = (
  overrides: Partial<MemoryDecision> = {}
): MemoryDecision => ({
  operation: "none",
  scope: "none",
  visibility: "private",
  category: "fact",
  subjectUserId: null,
  targetMemoryId: null,
  confidence: 0.8,
  memoryWorthiness: 0,
  involvesOtherUser: false,
  explicit: false,
  ...overrides
});

export const decisionOf = (overrides: Partial<MindDecision> = {}): MindDecision => ({
  intent: "friendly_banter",
  socialContext: "friendly_banter",
  relationshipSignal: "playful",
  userNeeds: "humor",
  goal: "maintain_rapport",
  action: "tease_back",
  humorStrategy: "light_tease",
  needsWeb: false,
  memory: memoryDecisionOf(),
  selectedMemories: [],
  confidence: 0.8,
  refined: false,
  source: "remote",
  ...overrides
});

export const contextOf = (overrides: Partial<MindContext> = {}): MindContext => ({
  request: requestOf(),
  relationship: relationshipOf(),
  candidates: [],
  conventions: [],
  recent: [],
  ...overrides
});

export const memoryRecordOf = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: 1,
  guildId: GUILD,
  scope: "user",
  kind: "semantic",
  category: "fact",
  ownerUserId: USER,
  subjectUserId: USER,
  createdByUserId: USER,
  visibility: "private",
  content: "민지는 커피를 좋아한다",
  structuredValue: null,
  confidence: 0.8,
  importance: 0.5,
  sourceMessageId: null,
  sourceChannelId: null,
  createdAt: 0,
  updatedAt: 0,
  lastAccessedAt: null,
  expiresAt: null,
  deletedAt: null,
  version: 1,
  ...overrides
});

export const candidateOf = (
  id: number,
  content: string,
  overrides: Partial<MemoryRecord> = {}
): MemoryCandidate => ({
  memory: memoryRecordOf({ id, content, ...overrides }),
  score: 0.8,
  matched: true
});

export const actorOf = (overrides: Partial<MemoryActor> = {}): MemoryActor => ({
  userId: USER,
  guildId: GUILD,
  isAdministrator: false,
  source: "discord_message",
  ...overrides
});

export const choice = (
  key: string,
  confidence = 0.8,
  probabilities?: Record<string, number>
) => ({
  type: "choice" as const,
  choice: key,
  confidence,
  probabilities: probabilities ?? { [key]: confidence }
});

export const fakeTextCommandMessage = (input: {
  admin?: boolean; userId?: string;
} = {}): { message: Message; replies: string[] } => {
  const replies: string[] = [];
  const message = {
    author: { id: input.userId ?? USER, bot: false },
    guildId: GUILD,
    member: { permissions: { has: () => input.admin ?? false } },
    guild: { members: { fetch: async (id: string) =>
      id === OTHER ? { id: OTHER, displayName: "민지" } : null
    } },
    reply: async (payload: { content: string }) => { replies.push(payload.content); }
  };
  return { message: message as unknown as Message, replies };
};
