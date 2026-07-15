import { describe, expect, it } from "vitest";
import {
  buildCreativeMixInstructions,
  buildSuccessMetricInstructions
} from "./use-generate-hooks";

describe("buildSuccessMetricInstructions", () => {
  it("passes the selected Brief metric through existing generation instructions", () => {
    expect(buildSuccessMetricInstructions("ROAS")).toBe(
      "Primary success metric: ROAS. Make the angle support this outcome without inventing performance claims."
    );
  });
});

describe("buildCreativeMixInstructions", () => {
  it("does not send zero-count content types to the hook prompt", () => {
    const state = {
      creativeMix: [
        { id: "static", service: "single-static", quantity: 2 },
        { id: "ugc", service: "ugc-video", quantity: 0 },
        { id: "album", service: "album-post", quantity: 0 }
      ],
      service: "single-static",
      quantity: 2
    } as const;

    expect(buildCreativeMixInstructions(state)).toBe(
      "Creative mix quota: Single static × 2. Generate 4 hook candidates in total. Candidate pool by content type: Single static × 4. Always generate 2 extra candidates for every active content type."
    );
  });
});
