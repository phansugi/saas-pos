/**
 * Store entry point.
 *
 * `StoreProvider` picks the implementation once, at startup, from the explicit
 * configuration in ./config. Because the choice happens by rendering one of two
 * different components, each implementation can use its own hooks (Convex's
 * `useQuery`/`useMutation`, or plain state) without ever calling hooks
 * conditionally.
 */

import type { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { convexUrl, dataSource } from "./config";
import { ConvexStoreProvider } from "./convex";
import { DemoStoreProvider } from "./demo";

export { useStore } from "./context";
export { dataSource, convexUrl } from "./config";
export * from "./types";

const client =
  dataSource === "convex" && convexUrl ? new ConvexReactClient(convexUrl) : null;

/**
 * Mounts the Convex client only when the app is configured to use it.
 *
 * `ConvexAuthProvider` menggantikan `ConvexProvider` (ia memasang provider Convex
 * yang sama, lalu menambahkan token identitas di atasnya). Itulah yang membuat
 * `ctx.auth.getUserIdentity()` terisi di server: tanpa provider ini, klien tidak
 * pernah mengirim token, dan setiap panggilan tetap datang sebagai "tanpa
 * identitas" walaupun penggunanya sudah masuk.
 *
 * Di mode demo tidak ada klien sama sekali, jadi tidak ada provider yang dipasang
 * dan halaman yang butuh identitas menampilkan keadaan terkuncinya.
 */
export function BackendProvider({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  if (dataSource === "convex" && client) {
    return <ConvexStoreProvider>{children}</ConvexStoreProvider>;
  }
  return <DemoStoreProvider>{children}</DemoStoreProvider>;
}
