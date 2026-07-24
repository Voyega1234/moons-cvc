import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  enabled: true,
  session: null as {
    user: {
      email: string;
      user_metadata: Record<string, unknown>;
    };
  } | null,
  signOut: vi.fn()
}));

vi.mock("./providers/auth-provider", () => ({
  useAuth: () => authMock
}));

import { AccountMenu, googleProfileImageUrl } from "./App";

describe("account menu profile image", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.enabled = true;
    authMock.session = {
      user: {
        email: "designer@convertcake.com",
        user_metadata: {
          avatar_url: "https://lh3.googleusercontent.com/profile-photo"
        }
      }
    };
  });

  it("shows the Google profile image and falls back when it fails", () => {
    render(<AccountMenu />);

    const accountButton = screen.getByRole("button", {
      name: "Open account menu"
    });
    const image = accountButton.querySelector("img");
    expect(image?.getAttribute("src")).toBe(
      "https://lh3.googleusercontent.com/profile-photo"
    );
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");

    fireEvent.error(image as HTMLImageElement);

    expect(accountButton.querySelector("img")).toBeNull();
    expect(accountButton.querySelector("svg")).toBeTruthy();
  });

  it("accepts the Google picture field but rejects non-HTTPS metadata", () => {
    expect(
      googleProfileImageUrl({
        user: {
          user_metadata: {
            picture: "https://lh3.googleusercontent.com/alternate-photo"
          }
        }
      } as never)
    ).toBe("https://lh3.googleusercontent.com/alternate-photo");

    expect(
      googleProfileImageUrl({
        user: {
          user_metadata: { avatar_url: "http://example.com/avatar.png" }
        }
      } as never)
    ).toBeNull();
  });
});
