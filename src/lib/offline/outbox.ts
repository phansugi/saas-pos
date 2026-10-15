/**
 * Offline-first outbox for the POS.
 *
 * A till must keep selling when the connection drops. Sales taken offline are
 * queued here and replayed later. The guarantee that makes this safe already
 * exists on the server: every sale carries a client-generated
 * `idempotencyKey`, and `pos.createSale` returns the original sale for a
 * repeated key. So the *same key is reused on every retry* and a replay can
 * never double-charge or double-deduct stock.
 *
 * Storage and transport are injected, so the whole engine is testable in Node
 * without a browser or a server.
 */

export interface OutboxEntry<TPayload> {
  /** Local identity of the queued action. */
  id: string;
  /** Stable across retries — never regenerated. */
  idempotencyKey: string;
  payload: TPayload;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Set when repeated attempts fail; needs a human, and no longer blocks others. */
  blocked: boolean;
}

export interface OutboxStorage<TPayload> {
  load(): OutboxEntry<TPayload>[];
  save(entries: OutboxEntry<TPayload>[]): void;
}

/** Thrown by a transport when the failure is connectivity, not rejection. */
export class OfflineError extends Error {
  readonly offline = true;
  constructor(message = "Tidak ada koneksi.") {
    super(message);
    this.name = "OfflineError";
  }
}

export function isOfflineError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { offline?: unknown }).offline === true
  );
}

/** Rejections like "insufficient stock" will never succeed on retry. */
export const MAX_ATTEMPTS = 5;

export interface FlushResult {
  sent: number;
  remaining: number;
  blocked: number;
  /** True when the flush stopped early because the device is offline. */
  stoppedOffline: boolean;
  lastError?: string;
}

export interface OutboxOptions<TPayload, TResult> {
  storage: OutboxStorage<TPayload>;
  send: (entry: OutboxEntry<TPayload>) => Promise<TResult>;
  /** Injectable for deterministic tests. */
  now?: () => number;
  newId?: () => string;
  maxAttempts?: number;
  onSent?: (entry: OutboxEntry<TPayload>, result: TResult) => void;
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export class Outbox<TPayload, TResult> {
  private entries: OutboxEntry<TPayload>[];
  private readonly storage: OutboxStorage<TPayload>;
  private readonly send: (entry: OutboxEntry<TPayload>) => Promise<TResult>;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly maxAttempts: number;
  private readonly onSent?: (entry: OutboxEntry<TPayload>, result: TResult) => void;
  private flushing = false;

  constructor(options: OutboxOptions<TPayload, TResult>) {
    this.storage = options.storage;
    this.send = options.send;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultId;
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.onSent = options.onSent;
    this.entries = this.storage.load();
  }

  get all(): OutboxEntry<TPayload>[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }

  /** Entries that gave up and need attention from a human. */
  get blockedCount(): number {
    return this.entries.filter((e) => e.blocked).length;
  }

  /** Entries still eligible for automatic replay. */
  get pendingCount(): number {
    return this.entries.filter((e) => !e.blocked).length;
  }

  /**
   * Queues an action and returns its entry. The idempotency key is minted once
   * here and reused for every later attempt.
   */
  enqueue(payload: TPayload): OutboxEntry<TPayload> {
    const entry: OutboxEntry<TPayload> = {
      id: this.newId(),
      idempotencyKey: this.newId(),
      payload,
      createdAt: this.now(),
      attempts: 0,
      blocked: false,
    };
    this.entries.push(entry);
    this.persist();
    return entry;
  }

  /**
   * Replays the queue oldest-first.
   *
   * - success removes the entry
   * - a connectivity failure stops the flush (the rest will fail too)
   * - a rejection is retried up to `maxAttempts`, then marked blocked so one
   *   bad order can never wedge the till
   */
  async flush(): Promise<FlushResult> {
    if (this.flushing) {
      return {
        sent: 0,
        remaining: this.size,
        blocked: this.blockedCount,
        stoppedOffline: false,
      };
    }

    this.flushing = true;
    let sent = 0;
    let stoppedOffline = false;
    let lastError: string | undefined;

    try {
      for (const entry of [...this.entries]) {
        if (entry.blocked) continue;

        try {
          const result = await this.send(entry);
          this.entries = this.entries.filter((e) => e.id !== entry.id);
          this.onSent?.(entry, result);
          sent += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          entry.attempts += 1;
          entry.lastError = message;
          lastError = message;

          if (isOfflineError(error)) {
            // Connectivity: keep the entry untouched and stop — nothing else
            // will get through either.
            stoppedOffline = true;
          } else if (entry.attempts >= this.maxAttempts) {
            entry.blocked = true;
          }
        }

        this.persist();
        if (stoppedOffline) break;
      }
    } finally {
      this.flushing = false;
      this.persist();
    }

    return {
      sent,
      remaining: this.size,
      blocked: this.blockedCount,
      stoppedOffline,
      lastError,
    };
  }

  /** Re-arms blocked entries after the underlying problem has been fixed. */
  retryBlocked(): number {
    let rearmed = 0;
    for (const entry of this.entries) {
      if (entry.blocked) {
        entry.blocked = false;
        entry.attempts = 0;
        delete entry.lastError;
        rearmed += 1;
      }
    }
    if (rearmed > 0) this.persist();
    return rearmed;
  }

  /** Drops a single entry (a cashier discarding a sale that cannot be saved). */
  discard(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }

  private persist(): void {
    this.storage.save(this.entries);
  }
}

/** localStorage-backed storage; a no-op shim when storage is unavailable. */
export function localStorageOutbox<TPayload>(key: string): OutboxStorage<TPayload> {
  return {
    load() {
      if (typeof window === "undefined") return [];
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as OutboxEntry<TPayload>[]) : [];
      } catch {
        return [];
      }
    },
    save(entries) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, JSON.stringify(entries));
      } catch {
        /* storage full or unavailable — keep the in-memory queue */
      }
    },
  };
}
