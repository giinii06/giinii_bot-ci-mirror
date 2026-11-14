import type { Database } from "bun:sqlite";

export type DecisionKind = "primary" | "refine";
export type DecisionStatus = "ok" | "error" | "limited" | "timeout" | "blocked";

export type Reservation = {
  requestId: string;
  /** 요청이 끝난 뒤 실제 결과로 사용량을 확정한다. 실패도 한도에 포함된다. */
  settle: (status: DecisionStatus, latencyMs: number) => void;
};

export type QuotaStats = {
  last24h: number;
  lastMinute: number;
  dailyBudget: number;
  minuteBudget: number;
};

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * OpenRouter 무료 요청 한도(계정 단위)를 넘지 않도록 자체 상한을 둔다.
 * 한도는 기니봇 전용이 아니므로 dailyBudget은 보장이 아니라 보호용 값이다.
 */
export class DecisionQuota {
  private sequence = 0;

  constructor(
    private readonly db: Database,
    private readonly limits: { dailyBudget: number; minuteBudget: number },
    private readonly now: () => number = Date.now
  ) {}

  private countSince(since: number): number {
    const row = this.db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM mind_decision_usage WHERE created_at >= ?"
      )
      .get(since);
    return row?.n ?? 0;
  }

  stats(): QuotaStats {
    const now = this.now();
    return {
      last24h: this.countSince(now - DAY_MS),
      lastMinute: this.countSince(now - MINUTE_MS),
      dailyBudget: this.limits.dailyBudget,
      minuteBudget: this.limits.minuteBudget
    };
  }

  /** 예산이 남았으면 사용량 행을 선점하고 예약을 돌려준다. */
  reserve(turnId: string, model: string, kind: DecisionKind): Reservation | null {
    const now = this.now();
    if (this.countSince(now - DAY_MS) >= this.limits.dailyBudget) return null;
    if (this.countSince(now - MINUTE_MS) >= this.limits.minuteBudget) return null;

    this.sequence += 1;
    const requestId = `${now.toString(36)}-${this.sequence.toString(36)}`;
    const insert = this.db.query(
      `INSERT INTO mind_decision_usage (request_id, turn_id, model, kind, status, latency_ms, created_at)
       VALUES (?, ?, ?, ?, 'reserved', 0, ?)`
    );
    const result = insert.run(requestId, turnId, model, kind, now);
    const rowId = Number(result.lastInsertRowid);

    return {
      requestId,
      settle: (status, latencyMs) => {
        this.db
          .query("UPDATE mind_decision_usage SET status = ?, latency_ms = ? WHERE id = ?")
          .run(status, Math.max(0, Math.round(latencyMs)), rowId);
      }
    };
  }

  /** /mind status 용 최근 실패율. */
  recentFailureRate(): number {
    const row = this.db
      .query<{ total: number; failed: number }, [number]>(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('error','timeout','limited') THEN 1 ELSE 0 END) AS failed
         FROM mind_decision_usage WHERE created_at >= ?`
      )
      .get(this.now() - DAY_MS);
    if (!row || row.total === 0) return 0;
    return (row.failed ?? 0) / row.total;
  }
}
