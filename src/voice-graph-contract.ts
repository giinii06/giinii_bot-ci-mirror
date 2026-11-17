/**
 * 서버와 브라우저 번들이 함께 쓰는 3D 친밀도 그래프 계약.
 * 이 파일은 다른 모듈을 import하지 않는다. 브라우저 쪽은 `import type`으로만 가져간다.
 */

export type GraphPeriod = "7d" | "30d" | "all";

export const GRAPH_PERIODS = ["7d", "30d", "all"] as const;

export const isGraphPeriod = (value: unknown): value is GraphPeriod =>
  typeof value === "string" && (GRAPH_PERIODS as readonly string[]).includes(value);

/** 그래프에 올리는 최대 인원. 2D PNG와 3D 화면이 같은 값을 쓴다. */
export const MAX_GRAPH_NODES = 20;

/** 커뮤니티 색. 서버 PNG와 브라우저 3D가 같은 색을 쓰도록 한 곳에 둔다. */
export const COMMUNITY_COLORS = [
  "#7c6bd0", "#229b90", "#d88c49", "#568fce", "#c76c9b",
  "#7e9851", "#b29b38", "#be6262", "#4e9fae", "#938174",
] as const;

export type EdgeKind = "mutual" | "one-sided" | "other";

export type GraphNode = {
  /** Discord user snowflake */
  id: string;
  name: string;
  /** same-origin 아바타 경로. 사진이 없으면 null */
  avatarPath: string | null;
  /** 선택 기간 안에서 이 사람이 음성 채널에 머문 시간. `all`은 누적 통화량과 같다. */
  voiceMs: number;
  community: number | null;
};

export type GraphLink = {
  source: string;
  target: string;
  /** 같은 채널에 함께 머문 시간만 더한다. 다른 채널은 합산하지 않는다. */
  sharedMs: number;
  kind: EdgeKind;
  /** 기존 PNG가 기본으로 그리는 top-7 상호 관계 */
  visibleByDefault: boolean;
};

export type GraphSnapshot = {
  schemaVersion: 1;
  guildId: string;
  period: GraphPeriod;
  /** 기간 시작. `all`이면 null */
  fromMs: number | null;
  toMs: number;
  generatedAtMs: number;
  semantics: "shared_voice_channel_presence";
  nodes: GraphNode[];
  links: GraphLink[];
};
