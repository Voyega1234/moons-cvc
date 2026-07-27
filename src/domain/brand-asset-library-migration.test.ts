import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202607270002_brand_asset_library.sql"
  ),
  "utf8"
);

describe("persistent brand asset library migration", () => {
  it("creates brand-scoped folders and assets with authenticated RLS", () => {
    expect(migration).toContain("create table if not exists moons.brand_asset_folders");
    expect(migration).toContain("create table if not exists moons.brand_assets");
    expect(migration).toContain("moons.is_convert_cake_user()");
  });

  it("keeps folders and assets in the same brand and category", () => {
    expect(migration).toContain(
      "foreign key (parent_id, client_id, asset_kind)"
    );
    expect(migration).toContain(
      "foreign key (folder_id, client_id, asset_kind)"
    );
  });

  it("deduplicates Google Drive folders and images", () => {
    expect(migration).toContain("brand_asset_folders_drive_source_unique");
    expect(migration).toContain("brand_assets_drive_source_unique");
  });
});
