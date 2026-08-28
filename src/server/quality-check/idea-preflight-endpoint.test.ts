import { describe, expect, it, vi } from "vitest";
import { handleIdeaPreflightRequest } from "./idea-preflight-endpoint";

function ideaRequest(
  checks: readonly ("quality" | "spelling" | "policy")[] = [
    "quality",
    "spelling"
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
      directions: [
        {
          id: "direction-1",
          service: "single-static",
          hook: "อยากเปลี่ยนพื้น แต่ไม่อยากเริ่มรื้อใหม่",
          subheadline: "พื้น SPC บางรุ่นปูทับพื้นเดิมได้",
          concept: "Before and after flooring comparison",
          visual: "Split room showing the old and new flooring",
          cta: "ปรึกษาการปูทับพื้นเดิม",
          caption: "เปลี่ยนบรรยากาศบ้านได้ง่ายขึ้น",
          formatBeats: [],
          revisionFeedback: ""
        }
      ]
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
                directionId: "direction-1",
                findings: [
                  {
                    check: "quality",
                    message:
                      "คำว่า “บางรุ่น” ควรระบุเงื่อนไขรุ่นให้ตรงกับข้อมูลสินค้าก่อนสร้างภาพ"
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
        findings: readonly { check: string; message: string }[];
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
              "คำว่า “บางรุ่น” ควรระบุเงื่อนไขรุ่นให้ตรงกับข้อมูลสินค้าก่อนสร้างภาพ"
          }
        ]
      }
    ]);
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
              results: [{ directionId: "direction-1", findings: [] }]
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
});
