export type BreakerState = "closed" | "open" | "half_open";

/**
 * Decision API가 반복해서 실패할 때 요청을 계속 보내지 않도록 막는다.
 * 복구 확인은 다음 적격 요청 한 번으로만 한다. 응답 중에 재시도를 반복하면 무료 한도만 낭비된다.
 */
export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  current(): BreakerState {
    if (this.state === "open" && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half_open";
    }
    return this.state;
  }

  allow(): boolean {
    return this.current() !== "open";
  }

  record(success: boolean): void {
    if (success) {
      this.state = "closed";
      this.failures = 0;
      return;
    }

    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.now();
      this.failures = 0;
    }
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAt = 0;
  }
}
