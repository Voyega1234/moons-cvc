import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrandMemoryProvider } from "../../../app/providers/brand-memory-provider";
import { MockBrandMemoryRepository } from "../../../repositories/brand-memory/mock-brand-memory-repository";
import { createInitialWorkflowState } from "../reducer";
import { BriefStage } from "./brief-stage";

const auth = vi.hoisted(() => ({ enabled: true, reconnectGoogle: vi.fn() }));
vi.mock("../../../app/providers/auth-provider", () => ({ useOptionalAuth: () => auth }));

beforeEach(() => { auth.reconnectGoogle.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

function renderFailure(message: string, dispatch = vi.fn()) {
  const state = createInitialWorkflowState({ id: "run-google-reconnect", now: "2026-11-02T00:00:00Z" });
  return render(<BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
    <BriefStage state={{ ...state, stage: "brief", ideaGenerationStatus: "failed", ideaGenerationError: message }} dispatch={dispatch} />
  </BrandMemoryProvider>);
}

describe("Brief Creative Approval Google access recovery", () => {
  it("lets the user grant the new Drive read access when a style import fails", async () => {
    renderFailure("Google access could not read Creative Approval or its artwork. Reconnect Google with read access to Sheets and Drive.");
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Google" }));
    await waitFor(() => expect(auth.reconnectGoogle).toHaveBeenCalledTimes(1));
  });

  it("surfaces a reconnect failure and leaves ordinary model errors without a Google action", async () => {
    const dispatch = vi.fn();
    auth.reconnectGoogle.mockRejectedValue(new Error("Connection failed"));
    const view = renderFailure("Reconnect Google", dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Google" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "fail-idea-generation", message: "Connection failed" }));
    view.unmount();
    renderFailure("Model is unavailable");
    expect(screen.queryByRole("button", { name: "Reconnect Google" })).toBeNull();
  });
});
