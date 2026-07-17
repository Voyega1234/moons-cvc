import { describe, expect, it } from "vitest";
import {
  canEditRun,
  departmentLabel,
  type RunOwnership
} from "./run-collaboration";

const ownership: RunOwnership = {
  workspaceRunId: "run-1",
  currentOwnerUserId: "user-gd",
  version: 3,
  status: "active",
  updatedAt: "2026-07-16T12:00:00.000Z"
};

describe("single-owner collaboration", () => {
  it("allows only the current owner to edit an existing run", () => {
    expect(canEditRun(ownership, "user-gd")).toBe(true);
    expect(canEditRun(ownership, "user-cs")).toBe(false);
    expect(canEditRun(ownership, null)).toBe(false);
  });

  it("lets a new unsynced run remain editable by its creator", () => {
    expect(canEditRun(null, "user-cs")).toBe(true);
  });

  it("uses short department labels in the handoff UI", () => {
    expect(departmentLabel("cs")).toBe("CS");
    expect(departmentLabel("gd")).toBe("GD");
    expect(departmentLabel("pm")).toBe("PM");
  });
});
