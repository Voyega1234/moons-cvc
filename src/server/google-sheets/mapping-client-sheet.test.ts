import { describe, expect, it, vi } from "vitest";
import {
  parseGoogleSheetUrl,
  readMappingClientsFromGoogleSheet,
  readOnboardingQuestionnaireFromGoogleSheet
} from "./mapping-client-sheet";

describe("parseGoogleSheetUrl", () => {
  it("reads a normal spreadsheet ID and selected gid", () => {
    expect(
      parseGoogleSheetUrl(
        "https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=147531213"
      )
    ).toEqual({ spreadsheetId: "sheet-123", sheetId: 147531213 });
  });

  it("rejects Publish to web and non-Google URLs", () => {
    expect(() =>
      parseGoogleSheetUrl(
        "https://docs.google.com/spreadsheets/d/e/published-id/pub"
      )
    ).toThrow("normal Google Sheet URL");
    expect(() =>
      parseGoogleSheetUrl("https://example.com/spreadsheets/d/sheet-123")
    ).toThrow("docs.google.com");
  });
});

describe("readMappingClientsFromGoogleSheet", () => {
  it("reads the selected tab and reports exactly which fields were extracted", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          properties: { title: "Client Mapping" },
          sheets: [
            { properties: { sheetId: 0, title: "Archive" } },
            { properties: { sheetId: 42, title: "Active Clients" } }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            [
              "No",
              "Client ID",
              "Status",
              "Service Status",
              "Client Portal"
            ],
            [
              "1",
              "Centre Point Group",
              "Active",
              "Retainer",
              "https://docs.google.com/spreadsheets/d/client-portal"
            ]
          ]
        })
      );

    await expect(
      readMappingClientsFromGoogleSheet({
        sheetUrl:
          "https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=42",
        accessToken: "sheets-token",
        fetchImpl
      })
    ).resolves.toEqual({
      clients: [
        {
          clientId: "Centre Point Group",
          status: "Active",
          serviceStatus: "Retainer",
          clientPortalUrl:
            "https://docs.google.com/spreadsheets/d/client-portal"
        }
      ],
      extraction: {
        spreadsheetTitle: "Client Mapping",
        sheetTitle: "Active Clients",
        rowCount: 1,
        fields: [
          "Client ID",
          "Status",
          "Service Status",
          "Client Portal"
        ]
      }
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      encodeURIComponent("'Active Clients'")
    );
  });
});

describe("readOnboardingQuestionnaireFromGoogleSheet", () => {
  it('reads the public "1. Questionnaire" tab without credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      gvizResponse({
        status: "ok",
        table: {
          cols: [{ label: "" }, { label: "" }, { label: "" }],
          rows: [
            {
              c: [
                { v: "{{brand_name_en}}" },
                null,
                { v: "Centre Point Hotels Group" }
              ]
            },
            {
              c: [
                { v: "{{billing_method_messenger}}" },
                { v: true },
                { v: "Messenger" }
              ]
            },
            {
              c: [
                { v: "{{marketing_past_efforts}}" },
                null,
                { v: "e.g. Channels and campaigns" },
                null,
                { v: "Seasonal hotel promotions" }
              ]
            },
            {
              c: [
                { v: "{{brand_media_channel_facebook}}" },
                null,
                { v: "Facebook: https://www.facebook.com/centrepointhotels" }
              ]
            }
          ]
        }
      })
    );

    await expect(
      readOnboardingQuestionnaireFromGoogleSheet({
        sheetUrl:
          "https://docs.google.com/spreadsheets/d/client-portal/edit#gid=0",
        fetchImpl
      })
    ).resolves.toEqual({
      sourceUrl:
        "https://docs.google.com/spreadsheets/d/client-portal/edit#gid=0",
      text:
        "Source tab: 1. Questionnaire\nExtracted fields: 4\n\nBrand name EN [brand_name_en]\nCentre Point Hotels Group\n\nBilling method messenger [billing_method_messenger]\nYes\n\nMarketing past efforts [marketing_past_efforts]\nSeasonal hotel promotions\n\nBrand media channel facebook [brand_media_channel_facebook]\nhttps://www.facebook.com/centrepointhotels",
      preview:
        "Source tab: 1. Questionnaire\nExtracted fields: 4\n\nBrand name EN [brand_name_en]\nCentre Point Hotels Group\n\nBilling method messenger [billing_method_messenger]\nYes\n\nMarketing past efforts [marketing_past_efforts]\nSeasonal hotel promotions\n\nBrand media channel facebook [brand_media",
      facebookUrls: ["https://www.facebook.com/centrepointhotels"],
      sheetTitle: "1. Questionnaire",
      extractedFields: [
        {
          key: "brand_name_en",
          label: "Brand name EN",
          value: "Centre Point Hotels Group"
        },
        {
          key: "billing_method_messenger",
          label: "Billing method messenger",
          value: "Yes"
        },
        {
          key: "marketing_past_efforts",
          label: "Marketing past efforts",
          value: "Seasonal hotel promotions"
        },
        {
          key: "brand_media_channel_facebook",
          label: "Brand media channel facebook",
          value: "https://www.facebook.com/centrepointhotels"
        }
      ]
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      `sheet=${encodeURIComponent("1. Questionnaire")}`
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("headers=0");
    expect(fetchImpl.mock.calls[0]?.[1]).toBeUndefined();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}

function gvizResponse(value: unknown): Response {
  return new Response(
    `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(value)});`,
    { headers: { "Content-Type": "application/javascript" } }
  );
}
