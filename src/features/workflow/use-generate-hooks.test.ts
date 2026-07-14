import { describe, expect, it } from "vitest";
import { buildSuccessMetricInstructions } from "./use-generate-hooks";

describe("buildSuccessMetricInstructions", () => {
  it("passes the selected Brief metric through existing generation instructions", () => {
    expect(buildSuccessMetricInstructions("ROAS")).toBe(
      "Primary success metric: ROAS. Make the angle support this outcome without inventing performance claims."
    );
  });
});
