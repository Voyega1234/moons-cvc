import { describe, expect, it, vi } from "vitest";
import { handleIdeaPreflightRequest } from "./idea-preflight-endpoint";

function ideaDirection(id: string) {
  return {
    id,
    service: "single-static",
    hook: "อยากเปลี่ยนพื้น แต่ไม่อยากเริ่มรื้อใหม่",
    subheadline: "พื้น SPC บางรุ่นปูทับพื้นเดิมได้",
    concept: "Before and after flooring comparison",
    visual: "Split room showing the old and new flooring",
    cta: "ปรึกษาการปูทับพื้นเดิม",
    caption: "เปลี่ยนบรรยากาศบ้านได้ง่ายขึ้น",
    formatBeats: [],
    revisionFeedback: ""
  };
}

function ideaRequest(
  checks: readonly ("quality" | "spelling" | "policy")[] = [
    "quality",
    "spelling"
  ],
  directions: readonly ReturnType<typeof ideaDirection>[] = [
    ideaDirection("direction-1")
  ]
) {
  return new Request("https://moons.local/api/idea-preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "run-idea-check",
      brief: "Make the flooring benefit clear to homeowners.",
      brandContext: {
        name: "Power Art Material",
        category: "Flooring",
        policies: [
          "Policy (Strictly apply): Do not promise guaranteed installation times."
        ],
        products: ["SPC flooring: Waterproof and easy to clean."],
        documents: [],
        working: ["Use before-and-after comparisons."],
        avoid: ["Do not promise impossible installation times."]
      },
      checks,
      directions
    })
  });
}

describe("handleIdeaPreflightRequest", () => {
  it("runs selected idea checks with GPT Luna and returns structured findings", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        model: string;
        input: readonly {
          content: readonly { text: string }[];
        }[];
        text: { format: { schema: unknown } };
      };
      expect(requestBody.model).toBe("gpt-5.6-luna");
      expect(requestBody.input[0]?.content[0]?.text).toContain(
        "Key Message ชัดและตรง Brief / Objective"
      );
      expect(requestBody.input[0]?.content[0]?.text).toContain(
        "การเว้นวรรคภาษาไทยผิดตำแหน่ง"
      );
      expect(requestBody.input[0]?.content[0]?.text).not.toContain(
        "Do not promise guaranteed installation times."
      );
      expect(JSON.stringify(requestBody.text.format.schema)).not.toContain(
        "maxItems"
      );

      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            results: [
              {
                ideaIndex: 1,
                findings: [
                  {
                    check: "quality",
                    message:
                      "คำว่า “บางรุ่น” ควรระบุเงื่อนไขรุ่นให้ตรงกับข้อมูลสินค้าก่อนสร้างภาพ",
                    field: "subheadline",
                    suggestion: "ระบุรุ่น SPC ที่รองรับให้ตรงกับสเปกสินค้า"
                  }
                ]
              }
            ]
          })
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await handleIdeaPreflightRequest({
      request: ideaRequest(),
      env: { OPENAI_API_KEY: "test-openai-key" },
      fetchImpl: fetchImpl as typeof fetch
    });
    const payload = (await response.json()) as {
      model: string;
      results: readonly {
        directionId: string;
        findings: readonly {
          check: string;
          message: string;
          field: string | null;
          suggestion: string | null;
        }[];
      }[];
    };

    expect(response.status).toBe(200);
    expect(payload.model).toBe("gpt-5.6-luna");
    expect(payload.results).toEqual([
      {
        directionId: "direction-1",
        findings: [
          {
            check: "quality",
            message:
              "คำว่า “บางรุ่น” ควรระบุเงื่อนไขรุ่นให้ตรงกับข้อมูลสินค้าก่อนสร้างภาพ",
            field: "subheadline",
            suggestion: "ระบุรุ่น SPC ที่รองรับให้ตรงกับสเปกสินค้า"
          }
        ]
      }
    ]);
  });

  it("clears the suggestion when a finding has no fixable field", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            results: [
              {
                ideaIndex: 1,
                findings: [
                  {
                    check: "policy",
                    message:
                      "คำกล่าวอ้างนี้ต้องได้รับการยืนยันจากทีมกฎหมายก่อน",
                    field: null,
                    suggestion: "ต้องส่งคำแนะนำ แม้ field จะเป็น null"
                  }
                ]
              }
            ]
          })
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await handleIdeaPreflightRequest({
      request: ideaRequest(["policy"]),
      env: { OPENAI_API_KEY: "test-openai-key" },
      fetchImpl: fetchImpl as typeof fetch
    });
    const payload = (await response.json()) as {
      results: readonly {
        findings: readonly {
          field: string | null;
          suggestion: string | null;
        }[];
      }[];
    };

    expect(response.status).toBe(200);
    expect(payload.results[0]?.findings[0]).toMatchObject({
      field: null,
      suggestion: null
    });
  });

  it("drops duplicate findings for the same idea", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            results: [
              {
                ideaIndex: 1,
                findings: [
                  {
                    check: "quality",
                    message: "คำว่า “บางรุ่น” ควรระบุเงื่อนไขให้ชัดเจน",
                    field: "subheadline",
                    suggestion: "ระบุรุ่นให้ตรงสเปก"
                  },
                  {
                    check: "quality",
                    message: "  คำว่า  “บางรุ่น”   ควรระบุเงื่อนไขให้ชัดเจน  ",
                    field: "subheadline",
                    suggestion: "ระบุรุ่นให้ตรงสเปก"
                  }
                ]
              }
            ]
          })
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await handleIdeaPreflightRequest({
      request: ideaRequest(),
      env: { OPENAI_API_KEY: "test-openai-key" },
      fetchImpl: fetchImpl as typeof fetch
    });
    const payload = (await response.json()) as {
      results: readonly { findings: readonly unknown[] }[];
    };

    expect(response.status).toBe(200);
    expect(payload.results[0]?.findings).toHaveLength(1);
  });

  it("adds Brand System Policy items when the policy checker is enabled", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body)) as {
          input: readonly { content: readonly { text: string }[] }[];
        };
        const prompt = requestBody.input[0]?.content[0]?.text ?? "";
        expect(prompt).toContain("Brand-specific policy");
        expect(prompt).toContain(
          "Policy (Strictly apply): Do not promise guaranteed installation times."
        );

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              results: [{ ideaIndex: 1, findings: [] }]
            })
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    );

    const response = await handleIdeaPreflightRequest({
      request: ideaRequest(["policy"]),
      env: { OPENAI_API_KEY: "test-openai-key" },
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(response.status).toBe(200);
  });

  it("ignores an out-of-range or duplicate ideaIndex instead of failing the whole check", async () => {
    const directions = [
      ideaDirection("direction-1"),
      ideaDirection("direction-2"),
      ideaDirection("direction-3")
    ];
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            results: [
              { ideaIndex: 1, findings: [] },
              { ideaIndex: 2, findings: [] },
              // Out-of-range index that was never offered (only 3 ideas).
              { ideaIndex: 99, findings: [] },
              // Duplicate of an index already seen above.
              { ideaIndex: 1, findings: [] }
            ]
          })
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await handleIdeaPreflightRequest({
      request: ideaRequest(["quality", "spelling"], directions),
      env: { OPENAI_API_KEY: "test-openai-key" },
      fetchImpl: fetchImpl as typeof fetch
    });
    const payload = (await response.json()) as {
      results: readonly { directionId: string; findings: readonly unknown[] }[];
    };

    expect(response.status).toBe(200);
    const returnedIds = payload.results.map((result) => result.directionId).sort();
    // direction-3 never got a valid result from the model, so it is
    // backfilled with an empty (non-blocking) finding list rather than
    // failing the entire request.
    expect(returnedIds).toEqual(["direction-1", "direction-2", "direction-3"]);
    expect(
      payload.results.find((result) => result.directionId === "direction-3")
    ).toMatchObject({ findings: [] });
  });

  it("drops a single malformed finding without dropping the rest", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            results: [
              {
                ideaIndex: 1,
                findings: [
                  {
                    check: "quality",
                    message: "Valid finding",
                    field: "hook",
                    suggestion: "Tighten the hook"
                  },
                  {
                    check: "not-a-real-check",
                    message: "Malformed finding",
                    field: null,
                    suggestion: null
                  }
                ]
              }
            ]
          })
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await handleIdeaPreflightRequest({
      request: ideaRequest(),
      env: { OPENAI_API_KEY: "test-openai-key" },
      fetchImpl: fetchImpl as typeof fetch
    });
    const payload = (await response.json()) as {
      results: readonly { findings: readonly { message: string }[] }[];
    };

    expect(response.status).toBe(200);
    expect(payload.results[0]?.findings).toEqual([
      expect.objectContaining({ message: "Valid finding" })
    ]);
  });
});
