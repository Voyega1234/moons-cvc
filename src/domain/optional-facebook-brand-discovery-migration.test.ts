import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608040001_optional_facebook_brand_discovery.sql"
  ),
  "utf8"
);

describe("optional Facebook brand discovery migration", () => {
  it("allows a blank Facebook URL while retaining validation for supplied URLs", () => {
    expect(migration).toContain(
      "nullif(trim(coalesce(p_facebook_url, '')), '') is not null"
    );
    expect(migration).toContain("facebook\\.com|fb\\.com");
  });

  it("persists a blank Facebook URL as null", () => {
    expect(migration).toContain(
      "facebook_url = nullif(trim(coalesce(p_facebook_url, '')), '')"
    );
  });
});
