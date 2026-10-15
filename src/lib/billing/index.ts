/**
 * App-facing entry point for the billing engine.
 *
 * The implementation lives in `src/convex/lib/billing/` because Convex only
 * bundles modules inside the functions directory (see convex.json → "src/convex"),
 * and the frontend and the backend must share exactly one copy of the plan
 * catalog, entitlement rules and money math. Re-exporting keeps app code on the
 * stable `@/lib/billing` path.
 */
export * from "@/convex/lib/billing";
