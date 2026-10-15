/**
 * React binding for the outbox: owns the queue instance, tracks connectivity,
 * and replays automatically when the connection comes back.
 *
 * The `send` callback is held in a ref so the queue instance (and therefore the
 * persisted idempotency keys) survives re-renders and changing callbacks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Outbox,
  localStorageOutbox,
  type FlushResult,
  type OutboxEntry,
} from "./outbox";

export interface UseOutboxOptions<TPayload, TResult> {
  storageKey: string;
  send: (entry: OutboxEntry<TPayload>) => Promise<TResult>;
}

export interface UseOutboxResult<TPayload, TResult> {
  online: boolean;
  /** Queued sales still eligible for automatic replay. */
  pending: number;
  /** Queued sales that gave up and need a human. */
  blocked: number;
  entries: OutboxEntry<TPayload>[];
  /** Queues a payload, then flushes immediately when online. */
  enqueue(payload: TPayload): Promise<{
    entry: OutboxEntry<TPayload>;
    result: TResult | null;
  }>;
  sync(): Promise<FlushResult>;
  retryBlocked(): number;
  discard(id: string): void;
}

function currentOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOutbox<TPayload, TResult>({
  storageKey,
  send,
}: UseOutboxOptions<TPayload, TResult>): UseOutboxResult<TPayload, TResult> {
  const sendRef = useRef(send);
  sendRef.current = send;

  const resultsRef = useRef(new Map<string, TResult>());
  // `version` forces a re-render *and* is a dependency of the memo below — the
  // queue mutates in place, so without it `pending`/`blocked` would keep
  // reporting the counts from the first render.
  const [version, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion((n) => n + 1), []);

  const outboxRef = useRef<Outbox<TPayload, TResult> | null>(null);
  if (!outboxRef.current) {
    outboxRef.current = new Outbox<TPayload, TResult>({
      storage: localStorageOutbox<TPayload>(storageKey),
      send: (entry) => sendRef.current(entry),
      onSent: (entry, result) => {
        resultsRef.current.set(entry.idempotencyKey, result);
        rerender();
      },
    });
  }
  const outbox = outboxRef.current;

  const [online, setOnline] = useState(currentOnline);

  const sync = useCallback(async (): Promise<FlushResult> => {
    const snapshot = await outbox.flush();
    rerender();
    return snapshot;
  }, [outbox, rerender]);

  // Replay as soon as the browser reports connectivity, and on first mount so a
  // queue left over from a previous session is drained.
  useEffect(() => {
    if (!online) return;
    void sync();
  }, [online, sync]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const enqueue = useCallback<UseOutboxResult<TPayload, TResult>["enqueue"]>(
    async (payload) => {
      const entry = outbox.enqueue(payload);
      rerender();
      if (!currentOnline()) {
        return { entry, result: null };
      }
      await sync();
      return { entry, result: resultsRef.current.get(entry.idempotencyKey) ?? null };
    },
    [outbox, rerender, sync],
  );

  const retryBlocked = useCallback(() => {
    const rearmed = outbox.retryBlocked();
    rerender();
    return rearmed;
  }, [outbox, rerender]);

  const discard = useCallback(
    (id: string) => {
      outbox.discard(id);
      rerender();
    },
    [outbox, rerender],
  );

  return useMemo(
    () => ({
      online,
      pending: outbox.pendingCount,
      blocked: outbox.blockedCount,
      entries: outbox.all,
      enqueue,
      sync,
      retryBlocked,
      discard,
    }),
    // `version` is the deliberate cache-buster for the mutable queue: this memo
    // must recompute whenever the counts change, not only when `online` does.
    [version, online, outbox, enqueue, sync, retryBlocked, discard],
  );
}
