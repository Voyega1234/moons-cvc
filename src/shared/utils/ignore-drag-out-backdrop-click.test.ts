import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ignoreDragOutBackdropClick } from "./ignore-drag-out-backdrop-click";

let stop: () => void;
const onBackdropClick = vi.fn();
let backdrop: HTMLElement, dialog: HTMLElement, button: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `<div class="output-modal-backdrop"><div class="dialog"><button><span>x</span></button></div></div>`;
  backdrop = document.querySelector(".output-modal-backdrop")!;
  dialog = document.querySelector(".dialog")!;
  button = document.querySelector("button")!;
  backdrop.addEventListener("click", onBackdropClick); // stands in for React's root handler
  stop = ignoreDragOutBackdropClick();
});
afterEach(() => { stop(); onBackdropClick.mockClear(); });

// The browser fires click on the common ancestor when down/up targets differ.
const press = (down: Element, clickTarget: Element) => {
  down.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

it("ignores a press that started in the dialog and was released on the backdrop", () => {
  press(dialog, backdrop);
  expect(onBackdropClick).not.toHaveBeenCalled();
});

it("still closes on a real backdrop click", () => {
  press(backdrop, backdrop);
  expect(onBackdropClick).toHaveBeenCalledOnce();
});

it("does not touch normal clicks inside the dialog, even across child elements", () => {
  const span = button.querySelector("span")!;
  const inner = vi.fn();
  button.addEventListener("click", inner);
  press(span, button); // down on icon, up on button: click lands on button
  expect(inner).toHaveBeenCalledOnce();
});
