import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { albumPanelPlan, composeAlbumPreview, generateIndependentAlbumPanels } from "./album-panels";
import { albumCropRegions, splitAlbumMaster } from "./album-master";

const hook = { id: "idea", hook: "Cover headline", subheadline: "Supporting line", concept: "One world",
  why: "", visual: "", caption: "", cta: "Order now", formatBeats: ["First benefit", "Second benefit", "Final benefit"] };
const png = (width: number, height: number, background: string) => sharp({
  create: { width, height, channels: 3, background }
}).png().toBuffer();

describe("independent Album panels", () => {
  it("uses a complete storyboard without attaching generated cover scenes to other panels", async () => {
    const bodies: { prompt: string; input_references: unknown[] }[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const bytes = await png(bodies.length === 1 ? 128 : 64, 64, "red");
      return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
    }) as unknown as typeof fetch;
    const logo = await png(8, 8, "blue");
    await generateIndependentAlbumPanels({ hook, format: "three-horizontal", prompt: "Campaign",
      references: [{ bytes: logo, mimeType: "image/png", label: "Official logo" }],
      apiKey: "test", model: "test", runId: "run", fetchImpl, writeDebugLog: async () => {},
      artDirection: { sharedStyle: "White and blue editorial photography", panels: [
        { index: 1, message: "Problem", scene: "Disconnected cable", composition: "Wide" },
        { index: 2, message: "Diagnosis", scene: "Three lenses", composition: "Top down" },
        { index: 3, message: "Plan", scene: "Architect desk", composition: "Eye level" }
      ] }
    });
    expect(bodies).toHaveLength(3);
    for (const body of bodies) expect(body.input_references).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${logo.toString("base64")}` } }
    ]);
    expect(bodies[1]?.prompt).toContain("This panel's scene: Three lenses");
    expect(bodies[2]?.prompt).toContain("This panel's composition: Eye level");
    expect(bodies[2]?.prompt).not.toContain("last attached image is the generated cover");
  });

  it("rejects incomplete storyboards before spending on images", async () => {
    const fetchImpl = vi.fn();
    await expect(generateIndependentAlbumPanels({ hook, format: "three-horizontal", prompt: "Campaign",
      references: [], apiKey: "test", model: "test", runId: "run", fetchImpl,
      writeDebugLog: async () => {}, artDirection: { sharedStyle: "Blue", panels: [] }
    })).rejects.toThrow("one complete shot per panel");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("keeps placeholder generation free of the original marketing copy", () => {
    const plan = albumPanelPlan(hook, "three-horizontal", true);
    expect(plan.map(p => p.copy)).toEqual(["HEADLINE\nSUBHEADLINE", "BODY", "BODY"]);
    expect(plan.map(p => p.cta)).toEqual(["", "", "CTA"]);
  });
  it.each([
    ["three-horizontal", "2048x1024", 3], ["three-vertical", "1024x2048", 3],
    ["four-vertical", "1024x1536", 4], ["four-grid", "1024x1024", 4],
    ["four-horizontal", "1920x1280", 4]
  ] as const)("plans native ratios and a single closing CTA for %s", (format, size, count) => {
    const plan = albumPanelPlan(hook, format);
    expect(plan).toHaveLength(count);
    expect(plan[0]?.size).toBe(size);
    expect(plan.filter(p => p.cta)).toEqual([plan[count - 1]]);
    expect(plan.slice(1).map(p => p.copy)).toEqual(hook.formatBeats.slice(0, count - 1));
  });

  it("delivers the horizontal four-image album at the requested pixels and preview positions", async () => {
    const sizes: string[] = [];
    const colors = ["red", "blue", "green", "yellow"];
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      sizes.push(body.size);
      const bytes = await png(sizes.length === 1 ? 96 : 64, 64, colors[sizes.length - 1]!);
      return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
    }) as unknown as typeof fetch;
    const result = await generateIndependentAlbumPanels({ hook, format: "four-horizontal", prompt: "Campaign",
      references: [], apiKey: "test", model: "test", runId: "run", fetchImpl, writeDebugLog: async () => {} });
    expect(sizes).toEqual(["1920x1280", "1920x1920", "1920x1920", "1920x1920"]);
    for (const [index, panel] of result.panels.entries()) {
      expect(await sharp(panel.bytes).metadata()).toMatchObject({ width: 1920, height: index === 0 ? 1280 : 1920 });
    }
    const { data, info } = await sharp(result.masterBytes).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(pixel(1000, 1000)).toEqual([255, 0, 0]);
    expect(pixel(300, 1700)).toEqual([0, 0, 255]);
    expect(pixel(1000, 1700)).toEqual([0, 128, 0]);
    expect(pixel(1700, 1700)).toEqual([255, 255, 0]);
  });

  it("keeps the legacy horizontal master crops non-overlapping and exports exact panel sizes", async () => {
    const regions = albumCropRegions({ left: 0, top: 0, side: 2046, format: "four-horizontal", boundaries: {} });
    expect(regions.map(({ left, top, width, height }) => ({ left, top, width, height }))).toEqual([
      { left: 0, top: 0, width: 2046, height: 1364 },
      { left: 0, top: 1364, width: 682, height: 682 },
      { left: 682, top: 1364, width: 682, height: 682 },
      { left: 1364, top: 1364, width: 682, height: 682 }
    ]);
    const panels = await splitAlbumMaster(await png(512, 512, "red"), "four-horizontal");
    for (const [index, panel] of panels.entries()) {
      expect(await sharp(panel.bytes).metadata()).toMatchObject({ width: 1920, height: index === 0 ? 1280 : 1920 });
    }
  });

  it("uses the completed cover for every supporting panel and preserves original image bytes", async () => {
    const cover = await png(128, 64, "red");
    const support = await png(64, 64, "blue");
    const requests: { size: string; prompt: string; input_references: unknown[] }[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [{ b64_json: (requests.length === 1 ? cover : support).toString("base64") }] }));
    }) as unknown as typeof fetch;
    const reviewPanel = vi.fn(async (image) => image);
    const result = await generateIndependentAlbumPanels({ hook, format: "three-horizontal", prompt: "Brand campaign",
      references: [], apiKey: "test", model: "gpt-image-2", runId: "run", fetchImpl,
      writeDebugLog: async () => {}, reviewPanel });
    expect(requests.map(r => r.size)).toEqual(["2048x1024", "1024x1024", "1024x1024"]);
    expect(requests[0]?.input_references).toEqual([]);
    for (const request of requests.slice(1)) {
      expect(request.input_references).toEqual([{ type: "image_url", image_url: { url: `data:image/png;base64,${cover.toString("base64")}` } }]);
      expect(request.prompt).toContain("Match its palette");
    }
    expect(result.panels.map(p => p.bytes)).toEqual([cover, support, support]);
    expect(reviewPanel).toHaveBeenCalledTimes(3);
    const { data, info } = await sharp(result.masterBytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2046);
    expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]);
    const bottom = (1500 * info.width + 100) * info.channels;
    expect([...data.subarray(bottom, bottom + 3)]).toEqual([0, 0, 255]);
  });

  it("fails before rendering when the content sequence is incomplete", () => {
    expect(() => albumPanelPlan({ ...hook, formatBeats: [] }, "four-grid")).toThrow("supporting content");
  });

  it("rejects wrong provider ratios instead of cropping them", async () => {
    const image = await png(64, 64, "red");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }))) as unknown as typeof fetch;
    await expect(generateIndependentAlbumPanels({ hook, format: "three-horizontal", prompt: "test", references: [],
      apiKey: "test", model: "test", runId: "run", fetchImpl, writeDebugLog: async () => {} })).rejects.toThrow("incorrect aspect ratio");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not assemble an incomplete preview", async () => {
    await expect(composeAlbumPreview([], "four-grid")).rejects.toThrow("Incomplete");
  });
});
