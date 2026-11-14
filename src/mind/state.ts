import type { Database } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import type { CharacterState, EmotionImpact, MindGoal, RelationshipState } from "./types.js";

export const DEFAULT_EMOTION = {
  valence: 0.55,
  arousal: 0.4,
  irritation: 0.09,
  curiosity: 0.67
};

export const DEFAULT_RELATIONSHIP: RelationshipState = {
  familiarity: 0,
  trust: 0.5,
  playfulness: 0.3,
  interactionCount: 0,
  boundaries: [],
  lastInteractionAt: 0
};

/** 사건 하나가 움직이는 기본 폭. intensity로 곱하고 maxDelta로 자른다. */
const EMOTION_DELTAS: Record<EmotionImpact, typeof DEFAULT_EMOTION> = {
  positive: { valence: 0.12, arousal: 0.08, irritation: -0.06, curiosity: 0.05 },
  negative: { valence: -0.12, arousal: 0.1, irritation: 0.14, curiosity: -0.03 },
  neutral: { valence: 0, arousal: -0.02, irritation: -0.04, curiosity: 0.01 }
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const decay = (value: number, base: number, halfLifeMinutes: number, elapsedMs: number): number => {
  if (elapsedMs <= 0 || halfLifeMinutes <= 0) return value;
  const halfLives = elapsedMs / (halfLifeMinutes * 60_000);
  return base + (value - base) * Math.pow(2, -halfLives);
};

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

export type StateConfig = {
  emotionEnabled: boolean;
  decayEnabled: boolean;
  halfLifeMinutes: {
    valence: number;
    arousal: number;
    irritation: number;
    curiosity: number;
  };
  maxDelta: number;
  relationshipEnabled: boolean;
  updateLimit: number;
};

type StateRow = {
  valence: number;
  arousal: number;
  irritation: number;
  curiosity: number;
  current_goal: string | null;
  updated_at: number;
};

type RelationshipRow = {
  familiarity: number;
  trust: number;
  playfulness: number;
  boundaries: string;
  interaction_count: number;
  last_interaction_at: number;
};

/**
 * 가상 감정과 사용자별 관계를 서버 DB에 보관한다.
 * 값은 LLM 프롬프트가 아니라 이 클래스를 통해서만 바뀐다.
 */
export class MindStateStore {
  constructor(
    private readonly db: Database,
    private readonly guildId: Snowflake | string,
    private readonly config: StateConfig
  ) {}

  loadEmotion(now = Date.now()): CharacterState {
    const row = this.db
      .query<StateRow, [string]>("SELECT * FROM mind_state WHERE guild_id = ?")
      .get(String(this.guildId));

    if (!row) {
      return { ...DEFAULT_EMOTION, currentGoal: null, updatedAt: now };
    }

    const elapsed = now - row.updated_at;
    const decayed =
      this.config.emotionEnabled && this.config.decayEnabled
        ? {
            valence: decay(row.valence, DEFAULT_EMOTION.valence, this.config.halfLifeMinutes.valence, elapsed),
            arousal: decay(row.arousal, DEFAULT_EMOTION.arousal, this.config.halfLifeMinutes.arousal, elapsed),
            irritation: decay(row.irritation, DEFAULT_EMOTION.irritation, this.config.halfLifeMinutes.irritation, elapsed),
            curiosity: decay(row.curiosity, DEFAULT_EMOTION.curiosity, this.config.halfLifeMinutes.curiosity, elapsed)
          }
        : {
            valence: row.valence,
            arousal: row.arousal,
            irritation: row.irritation,
            curiosity: row.curiosity
          };

    return {
      valence: clamp01(decayed.valence),
      arousal: clamp01(decayed.arousal),
      irritation: clamp01(decayed.irritation),
      curiosity: clamp01(decayed.curiosity),
      currentGoal: (row.current_goal as MindGoal | null) ?? null,
      updatedAt: row.updated_at
    };
  }

  saveEmotion(state: CharacterState, now = Date.now()): void {
    this.db
      .query(
        `INSERT INTO mind_state (guild_id, valence, arousal, irritation, curiosity, current_goal, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(guild_id) DO UPDATE SET
           valence = excluded.valence,
           arousal = excluded.arousal,
           irritation = excluded.irritation,
           curiosity = excluded.curiosity,
           current_goal = excluded.current_goal,
           updated_at = excluded.updated_at,
           version = mind_state.version + 1`
      )
      .run(
        String(this.guildId),
        clamp01(state.valence),
        clamp01(state.arousal),
        clamp01(state.irritation),
        clamp01(state.curiosity),
        state.currentGoal,
        now
      );
  }

  /** 사건의 감정 변화는 표에서 꺼내 적용하고, 한 번의 변화 폭을 제한한다. */
  applyEmotion(
    current: CharacterState,
    impact: EmotionImpact,
    intensity: number,
    goal: MindGoal,
    now = Date.now()
  ): CharacterState {
    if (!this.config.emotionEnabled) {
      return { ...current, currentGoal: goal, updatedAt: now };
    }

    const scale = clamp01(intensity);
    const delta = EMOTION_DELTAS[impact];
    const limit = this.config.maxDelta;
    const move = (value: number, step: number) =>
      clamp01(value + Math.max(-limit, Math.min(limit, step * scale)));

    return {
      valence: move(current.valence, delta.valence),
      arousal: move(current.arousal, delta.arousal),
      irritation: move(current.irritation, delta.irritation),
      curiosity: move(current.curiosity, delta.curiosity),
      currentGoal: goal,
      updatedAt: now
    };
  }

  loadRelationship(userId: string, now = Date.now()): RelationshipState {
    const row = this.db
      .query<RelationshipRow, [string, string]>(
        "SELECT * FROM mind_relationships WHERE guild_id = ? AND user_id = ?"
      )
      .get(String(this.guildId), userId);

    if (!row) return { ...DEFAULT_RELATIONSHIP, lastInteractionAt: now };

    return {
      familiarity: clamp01(row.familiarity),
      trust: clamp01(row.trust),
      playfulness: clamp01(row.playfulness),
      interactionCount: row.interaction_count,
      boundaries: parseBoundaries(row.boundaries),
      lastInteractionAt: row.last_interaction_at
    };
  }

  saveRelationship(userId: string, relationship: RelationshipState, now = Date.now()): void {
    this.db
      .query(
        `INSERT INTO mind_relationships
           (guild_id, user_id, familiarity, trust, playfulness, boundaries, interaction_count, last_interaction_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           familiarity = excluded.familiarity,
           trust = excluded.trust,
           playfulness = excluded.playfulness,
           boundaries = excluded.boundaries,
           interaction_count = excluded.interaction_count,
           last_interaction_at = excluded.last_interaction_at,
           version = mind_relationships.version + 1`
      )
      .run(
        String(this.guildId),
        userId,
        clamp01(relationship.familiarity),
        clamp01(relationship.trust),
        clamp01(relationship.playfulness),
        JSON.stringify(relationship.boundaries.slice(0, 10)),
        relationship.interactionCount,
        relationship.lastInteractionAt || now
      );
  }

  /**
   * 관계 점수는 천천히 움직이지만, 명시적인 거부는 즉시 반영한다.
   * 경계 문장은 사용자가 실제로 쓴 말을 그대로 남긴다.
   */
  applyInteraction(
    relationship: RelationshipState,
    signal: string,
    boundaryText: string | null,
    now = Date.now()
  ): RelationshipState {
    if (!this.config.relationshipEnabled) {
      return { ...relationship, interactionCount: relationship.interactionCount + 1, lastInteractionAt: now };
    }

    const step = this.config.updateLimit;
    const next: RelationshipState = {
      ...relationship,
      boundaries: [...relationship.boundaries],
      interactionCount: relationship.interactionCount + 1,
      lastInteractionAt: now
    };

    next.familiarity = clamp01(next.familiarity + 0.02);

    switch (signal) {
      case "warm":
        next.trust = clamp01(next.trust + step * 0.5);
        break;
      case "playful":
        next.playfulness = clamp01(next.playfulness + step);
        break;
      case "boundary_set":
        next.playfulness = clamp01(next.playfulness - step * 2);
        next.trust = clamp01(next.trust - step * 0.5);
        if (boundaryText) {
          const text = boundaryText.slice(0, 120);
          if (!next.boundaries.includes(text)) next.boundaries.push(text);
          next.boundaries = next.boundaries.slice(-10);
        }
        break;
      case "rejection":
        next.playfulness = clamp01(next.playfulness - step * 1.5);
        next.trust = clamp01(next.trust - step);
        break;
      default:
        break;
    }

    return next;
  }

  /** /memory clear 는 기억과 함께 관계 추정값도 지운다. */
  resetRelationship(userId: string): void {
    this.db
      .query("DELETE FROM mind_relationships WHERE guild_id = ? AND user_id = ?")
      .run(String(this.guildId), userId);
  }
}
