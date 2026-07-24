import { describe, expect, it, vi } from "vitest";
import { handleMappingClientsRequest } from "./mapping-clients-endpoint";

const baseEnv = {
  MAPPING_CLIENTS_GOOGLE_SHEET_URL:
    "https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0",
  GOOGLE_SERVICE_ACCOUNT_EMAIL:
    "compass-sheets@example-project.iam.gserviceaccount.com"
};

describe("handleMappingClientsRequest", () => {
  it("reads a published CSV mapping URL without OIDC or ADC", async () => {
    const publishedUrl =
      "https://docs.google.com/spreadsheets/d/e/published-id/pub?gid=147531213&single=true&output=csv";
    const createSheetsAccessToken = vi.fn(async () => "must-not-be-used");
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        [
          "",
          "No,Client ID,Status,Service Status",
          "1269,Vitalife,Inactive,"
        ].join("\n"),
        { headers: { "Content-Type": "text/csv" } }
      )
    );

    const response = await handleMappingClientsRequest({
      request: new Request("http://localhost/api/mapping-clients"),
      env: { MAPPING_CLIENTS_GOOGLE_SHEET_URL: publishedUrl },
      fetchImpl,
      createSheetsAccessToken
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      clients: [
        {
          clientId: "Vitalife",
          status: "Inactive",
          serviceStatus: ""
        }
      ]
    });
    expect(createSheetsAccessToken).not.toHaveBeenCalled();
  });

  it('reads the Client Portal "1. Questionnaire" tab on demand', async () => {
    const createSheetsAccessToken = vi.fn(async () => "sheets-token");
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("?fields=")
        ? jsonResponse({
            properties: { title: "Client portal" },
            sheets: [
              {
                properties: {
                  sheetId: 8,
                  title: "1. Questionnaire"
                }
              }
            ]
          })
        : jsonResponse({
            values: [
              ["{{products_target_customer}}", "", "Urban professionals"]
            ]
          })
    );
    const sourceUrl =
      "https://docs.google.com/spreadsheets/d/client-portal/edit#gid=8";
    const response = await handleMappingClientsRequest({
      request: new Request(
        `http://localhost/api/mapping-clients?questionnaireSheetUrl=${encodeURIComponent(sourceUrl)}`,
        { headers: { "X-Google-Access-Token": "google-provider-token" } }
      ),
      env: {
        ...baseEnv,
        GOOGLE_WORKSPACE_LOCAL_USER: "developer@convertcake.com"
      },
      fetchImpl,
      createSheetsAccessToken
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      questionnaire: {
        sourceUrl,
        text:
          "Source tab: 1. Questionnaire\nExtracted fields: 1\n\nProducts target customer [products_target_customer]\nUrban professionals",
        preview:
          "Source tab: 1. Questionnaire\nExtracted fields: 1\n\nProducts target customer [products_target_customer]\nUrban professionals",
        facebookUrls: [],
        sheetTitle: "1. Questionnaire",
        extractedFields: [
          {
            key: "products_target_customer",
            label: "Products target customer",
            value: "Urban professionals"
          }
        ]
      }
    });
    expect(createSheetsAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("sheets.googleapis.com/v4/spreadsheets"),
      expect.objectContaining({
        headers: { Authorization: "Bearer google-provider-token" }
      })
    );
  });

  it("requires Google OAuth access before reading a questionnaire", async () => {
    const sourceUrl =
      "https://docs.google.com/spreadsheets/d/client-portal/edit#gid=8";
    const response = await handleMappingClientsRequest({
      request: new Request(
        `http://localhost/api/mapping-clients?questionnaireSheetUrl=${encodeURIComponent(sourceUrl)}`
      ),
      env: baseEnv
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error:
        "Google access is required. Sign out, then sign in with Google again."
    });
  });

  it("uses the authenticated Convert Cake email in production", async () => {
    const createSheetsAccessToken = vi.fn(async () => "sheets-token");
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        return jsonResponse({ email: "designer@convertcake.com" });
      }
      if (url.includes("?fields=")) {
        return jsonResponse({
          properties: { title: "Mapping" },
          sheets: [{ properties: { sheetId: 0, title: "Clients" } }]
        });
      }
      return jsonResponse({
        values: [
          ["Client ID", "Status"],
          ["New Client", "Active"]
        ]
      });
    });

    const response = await handleMappingClientsRequest({
      request: new Request("https://example.com/api/mapping-clients", {
        headers: { Authorization: "Bearer supabase-token" }
      }),
      env: {
        ...baseEnv,
        VERCEL_ENV: "production",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      },
      oidcToken: "vercel-token",
      fetchImpl,
      createSheetsAccessToken
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      clients: [{ clientId: "New Client", status: "Active" }]
    });
    expect(createSheetsAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectEmail: "designer@convertcake.com",
        oidcToken: "vercel-token"
      })
    );
  });

  it("uses the configured local subject with ADC and rejects missing production auth", async () => {
    const createSheetsAccessToken = vi.fn(async () => "sheets-token");
    const localFetch = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("?fields=")
        ? jsonResponse({
            properties: { title: "Mapping" },
            sheets: [{ properties: { sheetId: 0, title: "Clients" } }]
          })
        : jsonResponse({ values: [["Client ID"], ["Local Client"]] })
    );
    const localResponse = await handleMappingClientsRequest({
      request: new Request("http://localhost/api/mapping-clients"),
      env: {
        ...baseEnv,
        GOOGLE_WORKSPACE_LOCAL_USER: "developer@convertcake.com"
      },
      fetchImpl: localFetch,
      createSheetsAccessToken
    });

    expect(localResponse.status).toBe(200);
    expect(createSheetsAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectEmail: "developer@convertcake.com",
        oidcToken: undefined
      })
    );

    const productionResponse = await handleMappingClientsRequest({
      request: new Request("https://example.com/api/mapping-clients"),
      env: { ...baseEnv, VERCEL_ENV: "production" },
      createSheetsAccessToken
    });
    expect(productionResponse.status).toBe(500);
    expect(await productionResponse.json()).toEqual({
      ok: false,
      error: "Supabase auth configuration is required."
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}
