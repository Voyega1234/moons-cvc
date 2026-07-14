export const GENERATION_SUCCESS_SOUND_PATH =
  "/universfield-new-notification-051-494246.mp3";

export function playGenerationSuccessSound(): void {
  if (typeof Audio === "undefined") return;

  const audio = new Audio(GENERATION_SUCCESS_SOUND_PATH);
  void audio.play().catch(() => {
    // Browsers may block audio until the user has interacted with the page.
  });
}
