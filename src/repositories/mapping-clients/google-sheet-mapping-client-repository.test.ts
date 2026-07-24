import { describe, expect, it, vi } from "vitest";
import { GoogleSheetMappingClientRepository } from "./google-sheet-mapping-client-repository";

describe("GoogleSheetMappingClientRepository", () => {
  it("loads mapped clients from the authenticated backend endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          clients: [
            {
              clientId: "Centre Point Group",
              status: "Active",
              serviceStatus: "Active",
              clientPortalUrl: "https://docs.google.com/client-portal"
            }
          ]
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    const repository = new GoogleSheetMappingClientRepository(
      "/api/mapping-clients",
      fetchImpl,
      async () => "supabase-token"
    );

    await expect(repository.list()).resolves.toEqual([
      {
        clientId: "Centre Point Group",
        status: "Active",
        serviceStatus: "Active",
        clientPortalUrl: "https://docs.google.com/client-portal"
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/mapping-clients", {
      cache: "no-store",
      headers: { Authorization: "Bearer supabase-token" }
    });
  });

  it("surfaces a failed backend response without caching it", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "Not configured." }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, clients: [] }), {
          headers: { "Content-Type": "application/json" }
        })
      );
    const repository = new GoogleSheetMappingClientRepository(
      "/api/mapping-clients",
      fetchImpl,
      async () => null
    );

    await expect(repository.list()).rejects.toThrow("Not configured.");
    await expect(repository.list()).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bypasses the five-minute cache when a refresh is requested", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            clients: [
              {
                clientId: "Existing client",
                status: "Active",
                serviceStatus: "Active"
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            clients: [
              {
                clientId: "Existing client",
                status: "Active",
                serviceStatus: "Active"
              },
              {
                clientId: "Vitalife",
                status: "Inactive",
                serviceStatus: ""
              }
            ]
          })
        )
      );
    const repository = new GoogleSheetMappingClientRepository(
      "/api/mapping-clients",
      fetchImpl,
      async () => "supabase-token"
    );

    await expect(repository.list()).resolves.toHaveLength(1);
    await expect(repository.list()).resolves.toHaveLength(1);
    await expect(
      repository.list({ forceRefresh: true })
    ).resolves.toEqual([
      expect.objectContaining({ clientId: "Existing client" }),
      expect.objectContaining({
        clientId: "Vitalife",
        status: "Inactive"
      })
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('loads the read-only "1. Questionnaire" tab on demand', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          questionnaire: {
            sourceUrl:
              "https://docs.google.com/spreadsheets/d/client-portal",
            text: "Primary audience\tUrban professionals",
            preview: "Primary audience\tUrban professionals",
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
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    const repository = new GoogleSheetMappingClientRepository(
      "/api/mapping-clients",
      fetchImpl,
      async () => "supabase-token",
      () => "google-provider-token"
    );

    await expect(
      repository.readQuestionnaire(
        "https://docs.google.com/spreadsheets/d/client-portal"
      )
    ).resolves.toEqual({
      sourceUrl: "https://docs.google.com/spreadsheets/d/client-portal",
      text: "Primary audience\tUrban professionals",
      preview: "Primary audience\tUrban professionals",
      facebookUrls: [],
      sheetTitle: "1. Questionnaire",
      extractedFields: [
        {
          key: "products_target_customer",
          label: "Products target customer",
          value: "Urban professionals"
        }
      ]
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "questionnaireSheetUrl=https%3A%2F%2Fdocs.google.com"
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual({
      cache: "no-store",
      headers: {
        Authorization: "Bearer supabase-token",
        "X-Google-Access-Token": "google-provider-token"
      }
    });
  });
});
