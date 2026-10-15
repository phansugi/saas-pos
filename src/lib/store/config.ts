/**
 * Which data source the app reads from.
 *
 * Convex is **opt-in**: setting `VITE_CONVEX_URL` alone is not enough, because
 * `convex dev` writes a loopback URL into .env.local that is only reachable
 * while a CLI process runs. Activating on presence alone would break the
 * preview and bake `127.0.0.1` into a production build.
 *
 * To go live, set both:
 *   VITE_CONVEX_URL=https://<deployment>.convex.cloud
 *   VITE_DATA_SOURCE=convex
 */

export const convexUrl: string | null =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? null;

const requested = (
  import.meta.env.VITE_DATA_SOURCE as string | undefined
)?.toLowerCase();

export const dataSource: "demo" | "convex" =
  requested === "convex" && convexUrl ? "convex" : "demo";

if (
  requested === "convex" &&
  !convexUrl &&
  typeof console !== "undefined"
) {
  console.warn(
    "VITE_DATA_SOURCE=convex diabaikan: VITE_CONVEX_URL belum diset. Aplikasi memakai data demo.",
  );
}
