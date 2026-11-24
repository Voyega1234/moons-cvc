/**
 * Modals close on a backdrop click. When a press starts inside the dialog (e.g.
 * dragging a textarea's resize handle) and ends on the backdrop, the browser
 * still fires `click` on the backdrop — the common ancestor — and the modal
 * closes by accident. Swallow that click so only a press that began on the
 * backdrop itself counts. Covers every `*backdrop*` element app-wide.
 */
export function ignoreDragOutBackdropClick(target: Document = document): () => void {
  let pressedOn: EventTarget | null = null;
  const onDown = (event: MouseEvent) => {
    pressedOn = event.target;
  };
  const onClick = (event: MouseEvent) => {
    const el = event.target;
    if (
      el instanceof Element &&
      /backdrop/.test(el.getAttribute("class") ?? "") &&
      pressedOn !== el
    ) {
      event.stopPropagation();
    }
  };
  target.addEventListener("mousedown", onDown, true);
  target.addEventListener("click", onClick, true);
  return () => {
    target.removeEventListener("mousedown", onDown, true);
    target.removeEventListener("click", onClick, true);
  };
}
