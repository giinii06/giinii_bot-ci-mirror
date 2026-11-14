/**
 * 같은 Discord 메시지를 두 번 처리하지 않는다.
 * 처리 중인 것과 이미 끝난 것을 구분해, 실패한 턴은 다시 시도할 수 있게 둔다.
 */
export class TurnGuard {
  private readonly inflight = new Set<string>();
  private readonly done = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly limit = 500) {}

  begin(id: string): boolean {
    if (this.inflight.has(id) || this.done.has(id)) return false;
    this.inflight.add(id);
    return true;
  }

  finish(id: string): void {
    this.inflight.delete(id);
    if (this.done.has(id)) return;
    this.done.add(id);
    this.order.push(id);
    while (this.order.length > this.limit) {
      const oldest = this.order.shift();
      if (oldest) this.done.delete(oldest);
    }
  }

  /** 실패한 턴은 완료로 남기지 않는다. 같은 메시지가 다시 오면 재처리한다. */
  abort(id: string): void {
    this.inflight.delete(id);
  }
}

/** 같은 사용자의 턴을 직렬화해 관계·기억 상태가 서로 덮어쓰지 않게 한다. */
export class KeyedSerialQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = previous.then(job, job);
    const guard = current.then(
      () => undefined,
      () => undefined
    );
    this.chains.set(key, guard);
    void guard.then(() => {
      if (this.chains.get(key) === guard) this.chains.delete(key);
    });
    return current;
  }
}
