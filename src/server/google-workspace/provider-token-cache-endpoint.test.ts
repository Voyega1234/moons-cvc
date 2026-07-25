import { describe, expect, it, vi } from "vitest";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  handleGoogleProviderTokenRequest,
  type GoogleProviderTokenEnv
} from "./provider-token-cache-endpoint";

const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const ENV: GoogleProviderTokenEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY.toString("base64")
};

describe("Google provider token cache endpoint", () => {
  it("round-trips refresh tokens with authenticated encryption", () => {
    const encrypted = encryptRefreshToken(
      "google-refresh-token",
      ENCRYPTION_KEY
    );

    expect(encrypted).not.toContain("google-refresh-token");
    expect(decryptRefreshToken(encrypted, ENCRYPTION_KEY)).toBe(
      "google-refresh-token"
    );
  });

  it("stores a Google refresh token encrypted for the authenticated user", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "0d4c7456-3876-47d4-bf72-4dfbcd614e40",
          email: "designer@convertcake.com"
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const response = await handleGoogleProviderTokenRequest({
      request: authorizedRequest("POST", {
        refreshToken: "google-refresh-token"
      }),
      env: ENV,
      fetchImpl
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const storeRequest = fetchImpl.mock.calls[1];
    expect(storeRequest?.[0]).toBe(
      "https://project.supabase.co/rest/v1/google_workspace_credentials?on_conflict=user_id"
    );
    const body = JSON.parse(
      String((storeRequest?.[1] as RequestInit | undefined)?.body)
    ) as {
      user_id: string;
      encrypted_refresh_token: string;
    };
    expect(body.user_id).toBe(
      "0d4c7456-3876-47d4-bf72-4dfbcd614e40"
    );
    expect(body.encrypted_refresh_token).not.toContain(
      "google-refresh-token"
    );
    expect(
      decryptRefreshToken(body.encrypted_refresh_token, ENCRYPTION_KEY)
    ).toBe("google-refresh-token");
  });

  it("returns a fresh Google access token from the stored credential", async () => {
    const encrypted = encryptRefreshToken(
      "google-refresh-token",
      ENCRYPTION_KEY
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "0d4c7456-3876-47d4-bf72-4dfbcd614e40",
          email: "designer@convertcake.com"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse([{ encrypted_refresh_token: encrypted }])
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "fresh-google-access-token",
          expires_in: 3_600
        })
      );

    const response = await handleGoogleProviderTokenRequest({
      request: authorizedRequest("GET"),
      env: ENV,
      fetchImpl
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      accessToken: "fresh-google-access-token",
      expiresIn: 3_600
    });
    const tokenRequest = fetchImpl.mock.calls[2];
    expect(tokenRequest?.[0]).toBe(
      "https://oauth2.googleapis.com/token"
    );
    expect(String((tokenRequest?.[1] as RequestInit | undefined)?.body)).toContain(
      "refresh_token=google-refresh-token"
    );
  });

  it("asks for one reconnect when no stored credential exists", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "0d4c7456-3876-47d4-bf72-4dfbcd614e40",
          email: "designer@convertcake.com"
        })
      )
      .mockResolvedValueOnce(jsonResponse([]));

    const response = await handleGoogleProviderTokenRequest({
      request: authorizedRequest("GET"),
      env: ENV,
      fetchImpl
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error:
        "Google access needs a one-time reconnect. Sign out and continue with Google once."
    });
  });
});

function authorizedRequest(
  method: string,
  body?: Record<string, string>
): Request {
  return new Request("https://example.com/api/google-provider-token", {
    method,
    headers: {
      Authorization: "Bearer supabase-access-token",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" }
  });
}
