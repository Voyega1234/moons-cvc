import { describe, expect, it, vi } from "vitest";
import { createGoogleSheetsAccessToken } from "./google-workspace-auth";

const baseEnv = {
  GOOGLE_CLOUD_PROJECT_NUMBER: "123456789",
  GOOGLE_WORKLOAD_IDENTITY_POOL: "vercel",
  GOOGLE_WORKLOAD_IDENTITY_PROVIDER: "compass",
  GOOGLE_SERVICE_ACCOUNT_EMAIL:
    "compass-sheets@example-project.iam.gserviceaccount.com"
};

describe("createGoogleSheetsAccessToken", () => {
  it("uses Vercel OIDC in production and exchanges a signed DWD JWT", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "federated-cloud-token" })
      )
      .mockResolvedValueOnce(jsonResponse({ signedJwt: "signed-jwt" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "sheets-token" }));
    const adcAccessTokenProvider = vi.fn(async () => "adc-token");

    await expect(
      createGoogleSheetsAccessToken({
        env: { ...baseEnv, VERCEL_ENV: "production" },
        subjectEmail: "Designer@convertcake.com",
        oidcToken: "vercel-oidc-token",
        fetchImpl,
        adcAccessTokenProvider,
        now: () => 1_700_000_000_000
      })
    ).resolves.toBe("sheets-token");

    expect(adcAccessTokenProvider).not.toHaveBeenCalled();
    const stsBody = fetchBody(fetchImpl, 0);
    expect(stsBody.get("subject_token")).toBe("vercel-oidc-token");
    expect(stsBody.get("audience")).toContain(
      "/workloadIdentityPools/vercel/providers/compass"
    );
    const signJwtBody = JSON.parse(
      String(fetchImpl.mock.calls[1]?.[1]?.body)
    ) as { payload: string };
    expect(JSON.parse(signJwtBody.payload)).toMatchObject({
      sub: "designer@convertcake.com",
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly"
    });
  });

  it("uses the user ADC Sheets token directly in local development", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adcAccessTokenProvider = vi.fn(async () => "adc-sheets-token");

    await expect(
      createGoogleSheetsAccessToken({
        env: {},
        subjectEmail: "developer@convertcake.com",
        fetchImpl,
        adcAccessTokenProvider
      })
    ).resolves.toBe("adc-sheets-token");

    expect(adcAccessTokenProvider).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects key-file ADC and non-Convert Cake subjects", async () => {
    await expect(
      createGoogleSheetsAccessToken({
        env: {
          ...baseEnv,
          GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json"
        },
        subjectEmail: "developer@convertcake.com",
        adcAccessTokenProvider: async () => "unused"
      })
    ).rejects.toThrow("Unset GOOGLE_APPLICATION_CREDENTIALS");

    await expect(
      createGoogleSheetsAccessToken({
        env: baseEnv,
        subjectEmail: "outsider@example.com",
        adcAccessTokenProvider: async () => "unused"
      })
    ).rejects.toThrow("@convertcake.com");
  });

  it("requires the service-account email only for Vercel deployments", async () => {
    await expect(
      createGoogleSheetsAccessToken({
        env: {
          VERCEL_ENV: "production",
          GOOGLE_CLOUD_PROJECT_NUMBER: "123456789",
          GOOGLE_WORKLOAD_IDENTITY_POOL: "vercel",
          GOOGLE_WORKLOAD_IDENTITY_PROVIDER: "compass"
        },
        subjectEmail: "developer@convertcake.com",
        oidcToken: "vercel-oidc-token"
      })
    ).rejects.toThrow("GOOGLE_SERVICE_ACCOUNT_EMAIL is required.");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}

function fetchBody(
  fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>,
  index: number
): URLSearchParams {
  return fetchImpl.mock.calls[index]?.[1]?.body as URLSearchParams;
}
