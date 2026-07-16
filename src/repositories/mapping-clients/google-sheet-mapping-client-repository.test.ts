import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuestionnaireBrandSource,
  GoogleSheetMappingClientRepository,
  parseCsv
} from "./google-sheet-mapping-client-repository";

afterEach(() => vi.unstubAllGlobals());

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

  it("extracts selectable Facebook pages and excludes contact details from brand evidence", () => {
    const source = buildQuestionnaireBrandSource(
      [
        "About your brand Brand Name: Centre Point Hotels Group",
        "Facebook: https://www.facebook.com/centrepointhotels",
        "Other Facebook: facebook.com/centrepointpattaya.",
        "Contacts Primary Contact Name: Private Person Phone: 0812345678"
      ].join(" "),
      "https://docs.google.com/client-portal"
    );

    expect(source.facebookUrls).toEqual([
      "https://www.facebook.com/centrepointhotels",
      "https://facebook.com/centrepointpattaya"
    ]);
    expect(source.text).toContain("Centre Point Hotels Group");
    expect(source.text).not.toContain("Private Person");
    expect(source.sourceUrl).toBe("https://docs.google.com/client-portal");
  });

  it("retries a Google HTML response and maps Questionnaire data by header name", async () => {
    const csv = [
      "No,Client ID,Status,Service Status,Client Portal,Questionnaire",
      '1,Centre Point Group,Active,Active,https://portal.example.com,"Brand Name: Centre Point Facebook: https://www.facebook.com/centrepointhotels Contacts Primary Contact Name: Hidden"'
    ].join("\n");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<!doctype html><title>Login</title>"))
      .mockResolvedValueOnce(new Response(csv));
    const repository = new GoogleSheetMappingClientRepository(
      "https://sheet.example.com",
      fetchImpl
    );

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        clientId: "Centre Point Group",
        status: "Active",
        serviceStatus: "Active",
        questionnaire: expect.objectContaining({
          facebookUrls: [
            "https://www.facebook.com/centrepointhotels"
          ],
          text: "Brand Name: Centre Point Facebook: https://www.facebook.com/centrepointhotels"
        })
      })
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not invoke the browser fetch function as a repository method", async () => {
    const csv = "No,Client ID,Status\n1,Centre Point Group,Active";
    let fetchThis: unknown;
    const nativeFetchLike = vi.fn(function (this: unknown) {
      fetchThis = this;
      if (this instanceof GoogleSheetMappingClientRepository) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(new Response(csv));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", nativeFetchLike);

    const repository = new GoogleSheetMappingClientRepository(
      "https://sheet.example.com"
    );

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ clientId: "Centre Point Group" })
    ]);
    expect(fetchThis).not.toBe(repository);
  });
});
