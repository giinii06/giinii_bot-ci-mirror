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
  confidence: 0,
  interactionCount: 0,
  positiveInteractionCount: 0,
  negativeFeedbackCount: 0,
  firstInteractionAt: now,
  lastInteractionAt: now,
  version: 1
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

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
 * 기억을 막는 경계 목록은 두지 않는다. 부정 피드백은 행동 조절용 통계로만 남긴다.
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
            confidence, interaction_count, positive_interaction_count,
            negative_feedback_count, first_interaction_at, last_interaction_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           familiarity = excluded.familiarity,
           rapport = excluded.rapport,
           playfulness = excluded.playfulness,
           engagement = excluded.engagement,
           communication_style = excluded.communication_style,
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
    now = Date.now()
  ): BotUserRelationship {
    const next: BotUserRelationship = {
      ...relationship,
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

  reset(userId: string): void {
    this.db
      .query("DELETE FROM mind_relationships WHERE guild_id = ? AND user_id = ?")
      .run(this.guild, userId);
  }
}
