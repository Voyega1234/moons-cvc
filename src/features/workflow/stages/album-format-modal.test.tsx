import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AlbumFormatModal } from "./album-format-modal";
import { buildDirectionFixtures } from "../test-fixtures";

afterEach(cleanup);

it("selects and restores the four-image horizontal cover format with its exact dimensions", () => {
  const onApply = vi.fn();
  const direction = { ...buildDirectionFixtures("Brand")[0]!, albumFormat: "four-horizontal" as const };
  render(<AlbumFormatModal direction={direction} onApply={onApply} onClose={vi.fn()} />);
  const choice = screen.getByRole("button", { name: /4 images · Horizontal lead/ });
  expect(choice.getAttribute("aria-pressed")).toBe("true");
  expect(choice.textContent).toContain("Cover 1920 × 1280 · 3 photos 1920 × 1920");
  expect(choice.querySelectorAll(".layout-four-horizontal i")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "4 images · Grid 4 photos" }));
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole("button", { name: "Use this Album format" }));
  expect(onApply).toHaveBeenCalledWith("four-horizontal");
});
