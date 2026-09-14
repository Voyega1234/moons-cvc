import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetPreviewImage } from "./brief-stage";

const src = "https://example.supabase.co/storage/v1/object/public/brand-assets/reference.jpg";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("asset library image preview", () => {
  it("shows an image already loaded from cache without waiting for another load event", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(320);
    render(<AssetPreviewImage src={src} alt="Reference" />);
    expect(screen.getByAltText("Reference").parentElement?.className).toContain("loaded");
  });
  it("falls back to the original when the thumbnail fails", () => {
    render(<AssetPreviewImage src={src} alt="Reference" />);
    expect(screen.getByAltText("Reference").getAttribute("src")).toContain("/render/image/public/");
    fireEvent.error(screen.getByAltText("Reference"));
    expect(screen.getByAltText("Reference").getAttribute("src")).toBe(src);
    fireEvent.load(screen.getByAltText("Reference"));
    expect(screen.getByAltText("Reference").parentElement?.className).toContain("loaded");
  });
  it("bounds a stalled thumbnail and original instead of leaving a permanent skeleton", () => {
    vi.useFakeTimers();
    render(<AssetPreviewImage src={src} alt="Reference" />);
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByAltText("Reference").getAttribute("src")).toBe(src);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole("status").textContent).toContain("Preview unavailable");
    expect(document.querySelector(".compass-asset-preview-skeleton")).toBeNull();
  });
  it("resets for a different source and ignores the previous image timer", () => {
    vi.useFakeTimers();
    const view = render(<AssetPreviewImage src={src} alt="Reference" />);
    act(() => vi.advanceTimersByTime(7000));
    view.rerender(<AssetPreviewImage src="https://example.com/new.jpg" alt="New" />);
    fireEvent.load(screen.getByAltText("New"));
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByAltText("New").getAttribute("src")).toBe("https://example.com/new.jpg");
    expect(screen.getByAltText("New").parentElement?.className).toContain("loaded");
  });
  it("stops after an original image error without retrying forever", () => {
    render(<AssetPreviewImage src={src} alt="Reference" />);
    fireEvent.error(screen.getByAltText("Reference"));
    fireEvent.error(screen.getByAltText("Reference"));
    expect(screen.getByRole("status").textContent).toContain("Preview unavailable");
  });
});
