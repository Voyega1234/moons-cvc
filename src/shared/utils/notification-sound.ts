export const GENERATION_SUCCESS_SOUND_PATH =
  "/universfield-new-notification-051-494246.mp3";
export const MAILBOX_NOTIFICATION_SOUND_PATH =
  "/universfield-new-notification-040-493469.mp3";

export function playGenerationSuccessSound(): void {
  playSound(GENERATION_SUCCESS_SOUND_PATH);
}

export function playMailboxNotificationSound(): void {
  playSound(MAILBOX_NOTIFICATION_SOUND_PATH);
}

function playSound(path: string): void {
  if (typeof Audio === "undefined") return;

  try {
    const playback = new Audio(path).play();
    void playback.catch(() => {
      // Browsers may block audio until the user has interacted with the page.
    });
  } catch {
    // Audio playback is optional feedback and must not interrupt the workflow.
  }
}
