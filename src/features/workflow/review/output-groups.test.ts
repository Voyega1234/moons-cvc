import { describe, expect, it } from "vitest";
import type { CreativeOutput } from "../../../domain/creative-run";
import {
  groupOutputsForReview,
  outputFormatSortRank,
  reviewCreativeCount,
  sortAlbumOutputs
} from "./output-groups";

function output(
  id: string,
  directionId: string,
  format: string
): CreativeOutput {
  return {
    id,
    directionId,
    format,
    status: "draft",
    clientStatus: "queued",
    revisionCount: 0,
    approval: {
      graphicDesign: null,
      clientService: null,
      projectManager: null
    },
    approvalComments: {
      graphicDesign: "",
      clientService: "",
      projectManager: ""
    }
  };
}

describe("creative review grouping", () => {
  it("treats an album as one creative and orders its panels", () => {
    const panelTwo = output(
      "direction-1-album-2-v1",
      "direction-1",
      "Album post"
    );
    const panelOne = output(
      "direction-1-album-1-v1",
      "direction-1",
      "Album post"
    );

    expect(sortAlbumOutputs([panelTwo, panelOne])).toEqual([
      panelOne,
      panelTwo
    ]);
    expect(groupOutputsForReview([panelTwo, panelOne])).toEqual([
      [panelOne, panelTwo]
    ]);
    expect(reviewCreativeCount([panelTwo, panelOne])).toBe(1);
  });

  it("keeps non-album outputs as separate creatives", () => {
    const single = output("single-1", "direction-1", "1:1 static");
    const ugc = output("ugc-1", "direction-2", "9:16 UGC");

    expect(groupOutputsForReview([single, ugc])).toEqual([[single], [ugc]]);
    expect(reviewCreativeCount([single, ugc])).toBe(2);
  });

  it("defines the requested Single, Album, UGC display order", () => {
    expect(
      ["9:16 UGC", "Album post", "1:1 static"].sort(
        (left, right) =>
          outputFormatSortRank(left) - outputFormatSortRank(right)
      )
    ).toEqual(["1:1 static", "Album post", "9:16 UGC"]);
  });
});
