import { describe, expect, it } from "vitest";
import { parseCsv } from "./google-sheet-mapping-client-repository";

describe("parseCsv", () => {
  it("parses quoted commas, escaped quotes, and newlines", () => {
    expect(
      parseCsv('h1,h2,h3\n1,"A, B","He said ""yes"""\n2,plain,last')
    ).toEqual([
      ["h1", "h2", "h3"],
      ["1", "A, B", 'He said "yes"'],
      ["2", "plain", "last"]
    ]);
  });
});
