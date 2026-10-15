/**
 * React binding for the authorization table.
 *
 * The policy itself is shared with the backend (see src/convex/lib/authz.ts),
 * and peran kustom (`rbac.custom`) ikut dihitung dengan aturan yang sama
 * (`src/convex/lib/rbac.ts`) — jadi `can` di klien dan `requirePermission` di
 * server tidak pernah menjawab berbeda. Client-side checks are a UX layer — they
 * decide what a cashier *sees* — while the server re-checks the same permission
 * on every mutation it guards.
 */

import { useMemo } from "react";
import type { Permission, Role } from "@/lib/authz";
import { actingPermissions, actingRole, useSession } from "@/lib/session";

/** The acting role for the current tenant (peran bawaan, bukan peran kustom). */
export function useRole(): Role {
  const { session } = useSession();
  return actingRole(session);
}

/** `const can = useCan(); can("pos.void")` */
export function useCan(): (permission: Permission) => boolean {
  const { session } = useSession();
  const permissions = useMemo(() => actingPermissions(session), [session]);
  return useMemo(
    () => (permission: Permission) => permissions.includes(permission),
    [permissions],
  );
}

/** Every permission the acting user holds, for team/settings screens. */
export function usePermissions(): Permission[] {
  const { session } = useSession();
  return useMemo(() => actingPermissions(session), [session]);
}
