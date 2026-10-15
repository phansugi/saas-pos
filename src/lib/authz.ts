/**
 * App-facing entry point for the authorization model.
 *
 * The implementation lives in `src/convex/lib/authz.ts` so the backend and the
 * client enforce the exact same table. See that file for the role/permission
 * policy.
 */
export * from "@/convex/lib/authz";
