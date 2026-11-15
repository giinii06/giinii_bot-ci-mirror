import type { Database } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import {
  COMMUNICATION_STYLES,
  type BotUserRelationship,
  type CommunicationStyle
} from "../types.js";

export const DEFAULT_RELATIONSHIP = (
  guildId: string,
  userId: string,
  now: number
): BotUserRelationship => ({
  guildId,
  userId,
  familiarity: 0,
  rapport: 0.5,
  playfulness: 0.3,
  engagement: 0,
  communicationStyle: "default",
  boundaries: [],
  confidence: 0,
  interactionCount: 0,
  positiveInteractionCount: 0,
  negativeFeedbackCount: 0,
  firstInteractionAt: now,
  lastInteractionAt: now,
  version: 1
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const parseBoundaries = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [];
  } catch {
    return [];
  }
};

const parseStyle = (raw: string): CommunicationStyle =>
  (COMMUNICATION_STYLES as readonly string[]).includes(raw)
    ? (raw as CommunicationStyle)
    : "default";

type RelationshipRow = {
  familiarity: number;
  rapport: number;
  playfulness: number;
  engagement: number;
  communication_style: string;
  boundaries: string;
  confidence: number;
  interaction_count: number;
  positive_interaction_count: number;
  negative_feedback_count: number;
  first_interaction_at: number;
  last_interaction_at: number;
  version: number;
};

export type RelationshipConfig = {
  enabled: boolean;
  updateLimit: number;
};

/**
 * 기니봇과 사용자 사이의 관계 값만 보관한다.
 * 점수는 상호작용 조절용 내부 상태이고, 명시적 경계는 점수와 무관하게 즉시 반영한다.
 */
export class BotUserRelationshipStore {
  constructor(
    private readonly db: Database,
    private readonly guildId: Snowflake | string,
    private readonly config: RelationshipConfig
  ) {}

  private get guild(): string {
    return String(this.guildId);
  }

  load(userId: string, now = Date.now()): BotUserRelationship {
    const row = this.db
      .query<RelationshipRow, [string, string]>(
        "SELECT * FROM mind_relationships WHERE guild_id = ? AND user_id = ?"
      )
      .get(this.guild, userId);

    if (!row) return DEFAULT_RELATIONSHIP(this.guild, userId, now);

    return {
      guildId: this.guild,
      userId,
      familiarity: clamp01(row.familiarity),
      rapport: clamp01(row.rapport),
      playfulness: clamp01(row.playfulness),
      engagement: clamp01(row.engagement),
      communicationStyle: parseStyle(row.communication_style),
      boundaries: parseBoundaries(row.boundaries),
      confidence: clamp01(row.confidence),
      interactionCount: row.interaction_count,
      positiveInteractionCount: row.positive_interaction_count,
      negativeFeedbackCount: row.negative_feedback_count,
      firstInteractionAt: row.first_interaction_at,
      lastInteractionAt: row.last_interaction_at,
      version: row.version
    };
  }

  save(relationship: BotUserRelationship, now = Date.now()): void {
    this.db
      .query(
        `INSERT INTO mind_relationships
           (guild_id, user_id, familiarity, rapport, playfulness, engagement, communication_style,
            boundaries, confidence, interaction_count, positive_interaction_count,
            negative_feedback_count, first_interaction_at, last_interaction_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           familiarity = excluded.familiarity,
           rapport = excluded.rapport,
           playfulness = excluded.playfulness,
           engagement = excluded.engagement,
           communication_style = excluded.communication_style,
           boundaries = excluded.boundaries,
           confidence = excluded.confidence,
           interaction_count = excluded.interaction_count,
           positive_interaction_count = excluded.positive_interaction_count,
           negative_feedback_count = excluded.negative_feedback_count,
           first_interaction_at = excluded.first_interaction_at,
           last_interaction_at = excluded.last_interaction_at,
           version = mind_relationships.version + 1`
      )
      .run(
        this.guild,
        relationship.userId,
        clamp01(relationship.familiarity),
        clamp01(relationship.rapport),
        clamp01(relationship.playfulness),
        clamp01(relationship.engagement),
        relationship.communicationStyle,
        JSON.stringify(relationship.boundaries.slice(0, 10)),
        clamp01(relationship.confidence),
        relationship.interactionCount,
        relationship.positiveInteractionCount,
        relationship.negativeFeedbackCount,
        relationship.firstInteractionAt || now,
        relationship.lastInteractionAt || now
      );
  }

  /** 관계 점수는 천천히 움직인다. 한 번의 변화 폭은 updateLimit으로 자른다. */
  applyInteraction(
    relationship: BotUserRelationship,
    signal: string,
    boundaryText: string | null,
    now = Date.now()
  ): BotUserRelationship {
    const next: BotUserRelationship = {
      ...relationship,
      boundaries: [...relationship.boundaries],
      interactionCount: relationship.interactionCount + 1,
      lastInteractionAt: now,
      firstInteractionAt: relationship.firstInteractionAt || now
    };

    if (!this.config.enabled) return next;

    const step = this.config.updateLimit;
    next.familiarity = clamp01(next.familiarity + 0.02);
    next.engagement = clamp01(next.engagement + step * 0.5);
    next.confidence = clamp01(next.interactionCount / 20);

    switch (signal) {
      case "warm":
        next.rapport = clamp01(next.rapport + step * 0.5);
        next.positiveInteractionCount += 1;
        break;
      case "playful":
        next.playfulness = clamp01(next.playfulness + step);
        next.rapport = clamp01(next.rapport + step * 0.3);
        next.positiveInteractionCount += 1;
        break;
      case "boundary_set":
        next.playfulness = clamp01(next.playfulness - step * 2);
        next.rapport = clamp01(next.rapport - step * 0.5);
        next.negativeFeedbackCount += 1;
        if (boundaryText) {
          const text = boundaryText.slice(0, 120);
          if (!next.boundaries.includes(text)) next.boundaries.push(text);
          next.boundaries = next.boundaries.slice(-10);
        }
        break;
      case "rejection":
        next.playfulness = clamp01(next.playfulness - step * 1.5);
        next.rapport = clamp01(next.rapport - step);
        next.negativeFeedbackCount += 1;
        break;
      default:
        break;
    }

    return next;
  }

  /** 본인 호칭 거부처럼 즉시 남겨야 하는 경계. 점수 변화와 별개로 저장한다. */
  recordBoundary(userId: string, text: string, now = Date.now()): void {
    const current = this.load(userId, now);
    const boundary = text.slice(0, 120);
    if (!boundary || current.boundaries.includes(boundary)) return;
    this.save(
      {
        ...current,
        boundaries: [...current.boundaries, boundary].slice(-10),
        negativeFeedbackCount: current.negativeFeedbackCount + 1,
        lastInteractionAt: now
      },
      now
    );
  }

  reset(userId: string): void {
    this.db
      .query("DELETE FROM mind_relationships WHERE guild_id = ? AND user_id = ?")
      .run(this.guild, userId);
  }
}
