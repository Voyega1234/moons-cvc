import { describe, expect, it, vi } from "vitest";
import {
  isPublishedGoogleSheetUrl,
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

  it("recognizes a Publish to web CSV URL", () => {
    expect(
      isPublishedGoogleSheetUrl(
        "https://docs.google.com/spreadsheets/d/e/published-id/pub?gid=147531213&single=true&output=csv"
      )
    ).toBe(true);
  });
});

describe("readMappingClientsFromGoogleSheet", () => {
  it("reads a published CSV mapping tab without Google credentials", async () => {
    const publishedUrl =
      "https://docs.google.com/spreadsheets/d/e/published-id/pub?gid=147531213&single=true&output=csv";
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        [
          "",
          "No,Client ID,Status,Service Status,Client Portal",
          "1269,Vitalife,Inactive,,",
          '1270,"Tri Petch, Isuzu Leasing",Inactive,,'
        ].join("\n"),
        { headers: { "Content-Type": "text/csv" } }
      )
    );

    await expect(
      readMappingClientsFromGoogleSheet({
        sheetUrl: publishedUrl,
        accessToken: "",
        fetchImpl
      })
    ).resolves.toEqual({
      clients: [
        {
          clientId: "Vitalife",
          status: "Inactive",
          serviceStatus: ""
        },
        {
          clientId: "Tri Petch, Isuzu Leasing",
          status: "Inactive",
          serviceStatus: ""
        }
      ],
      extraction: {
        spreadsheetTitle: "Published mapping sheet",
        sheetTitle: "gid 147531213",
        rowCount: 2,
        fields: [
          "Client ID",
          "Status",
          "Service Status",
          "Client Portal"
        ]
      }
    });
    expect(fetchImpl).toHaveBeenCalledWith(publishedUrl, {
      cache: "no-store"
    });
  });

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
  it('reads the private "1. Questionnaire" tab with the signed-in Google token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          properties: { title: "Client portal" },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: "1. Questionnaire"
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            ["{{brand_name_en}}", "", "Centre Point Hotels Group"],
            ["{{billing_method_messenger}}", true, "Messenger"],
            [
              "{{marketing_past_efforts}}",
              "",
              "e.g. Channels and campaigns",
              "",
              "Seasonal hotel promotions"
            ],
            [
              "{{brand_media_channel_facebook}}",
              "",
              "Facebook: https://www.facebook.com/centrepointhotels"
            ]
          ]
        })
      );

    await expect(
      readOnboardingQuestionnaireFromGoogleSheet({
        sheetUrl:
          "https://docs.google.com/spreadsheets/d/client-portal/edit#gid=0",
        accessToken: "google-provider-token",
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
      "sheets.googleapis.com/v4/spreadsheets/client-portal"
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      encodeURIComponent("'1. Questionnaire'")
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual({
      headers: { Authorization: "Bearer google-provider-token" }
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}
