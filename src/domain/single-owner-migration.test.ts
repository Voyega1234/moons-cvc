import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202607160002_single_owner_handoffs.sql"
  ),
  "utf8"
);

describe("single-owner database migration", () => {
  it("locks the run and checks its expected version before handoff", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("current_run.version <> p_expected_version");
  });

  it("changes ownership and records the audit event in one function", () => {
    expect(migration).toContain("current_owner_user_id = p_to_user_id");
    expect(migration).toContain("insert into moons.run_handoffs");
  });

  it("allows run updates only for the current owner", () => {
    expect(migration).toContain('create policy "current owners can update runs"');
    expect(migration).toContain("current_owner_user_id = auth.uid()");
  });
});
