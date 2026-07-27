import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202607270001_checkpoint_brand_restore_guard.sql"
  ),
  "utf8"
);

describe("checkpoint brand restore guard migration", () => {
  it("compares the restored client with the current project client", () => {
    expect(migration).toContain(
      "restored_brand_id is distinct from current_brand_id"
    );
    expect(migration).toContain(
      "This recovery point belongs to a different client"
    );
  });

  it("checks the client before replacing the current snapshot", () => {
    expect(
      migration.indexOf(
        "restored_brand_id is distinct from current_brand_id"
      )
    ).toBeLessThan(
      migration.indexOf("set snapshot = checkpoint_record.snapshot")
    );
  });
});
