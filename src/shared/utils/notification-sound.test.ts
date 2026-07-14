import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERATION_SUCCESS_SOUND_PATH,
  playGenerationSuccessSound
} from "./notification-sound";

const originalAudio = globalThis.Audio;

afterEach(() => {
  globalThis.Audio = originalAudio;
  vi.restoreAllMocks();
});

describe("playGenerationSuccessSound", () => {
  it("plays the configured notification asset", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function (this: { play: typeof play }) {
      this.play = play;
    });
    globalThis.Audio = AudioMock as unknown as typeof Audio;

    playGenerationSuccessSound();

    expect(AudioMock).toHaveBeenCalledWith(GENERATION_SUCCESS_SOUND_PATH);
    expect(play).toHaveBeenCalledOnce();
  });

  it("does not throw when browser autoplay blocks the sound", async () => {
    const play = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    globalThis.Audio = vi.fn(function (this: { play: typeof play }) {
      this.play = play;
    }) as unknown as typeof Audio;

    expect(() => playGenerationSuccessSound()).not.toThrow();
    await Promise.resolve();
  });
});
