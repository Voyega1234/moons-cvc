import type { Brand } from "./brand";

/**
 * Client visibility is intentionally decided before brands reach feature UI.
 * Today everyone uses `all`; later an auth-backed assignment adapter can
 * provide the signed-in user's client IDs while database RLS enforces the
 * same boundary server-side.
 */
export type ClientAccessScope =
  | { kind: "all" }
  | { kind: "assigned"; clientIds: readonly string[] };

export const allClientAccess: ClientAccessScope = { kind: "all" };

export function filterBrandsForAccess(
  brands: readonly Brand[],
  access: ClientAccessScope
): readonly Brand[] {
  if (access.kind === "all") return brands;
  const allowedIds = new Set(access.clientIds);
  return brands.filter((brand) => allowedIds.has(brand.id));
}
