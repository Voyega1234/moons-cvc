import { describe, expect, it } from "vitest";
import { toWebRequest } from "./mapping-clients";

describe("mapping-clients Vercel adapter", () => {
  it("preserves the Questionnaire Google Sheet URL query parameter", () => {
    const sheetUrl =
      "https://docs.google.com/spreadsheets/d/client-portal/edit?gid=577277204#gid=577277204";
    const request = toWebRequest({
      method: "GET",
      url:
        `/api/mapping-clients?questionnaireSheetUrl=` +
        encodeURIComponent(sheetUrl),
      headers: {}
    });

    expect(request.url).toContain("questionnaireSheetUrl=");
    expect(new URL(request.url).searchParams.get("questionnaireSheetUrl")).toBe(
      sheetUrl
    );
  });
});
