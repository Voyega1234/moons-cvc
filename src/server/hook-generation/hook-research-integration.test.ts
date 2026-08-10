import { describe, expect, it, vi } from "vitest";
import { handleHookGenerationHarnessRequest } from "./hook-generation-harness-endpoint";
import type { HookGenerationDebugLog } from "./hook-generation-debug-log";

function jsonResponse(output: unknown) {
  return new Response(
    JSON.stringify({ output_text: JSON.stringify(output) }),
    { status: 200 }
  );
}

describe("dedicated Hook Research Agent pipeline", () => {
  it("researches once, then sends the evidence dossier to a tool-free Hook Agent", async () => {
    const sourceUrl = "https://example.com/thai-consumer-report";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Convert Cake",
          productFocus: "AI SEO webinar",
          overallFinding: "ธุรกิจต้องการหลักฐาน visibility ที่ตรวจสอบได้",
          references: [
            {
              id: "ref-01",
              name: "Thai AI search behavior",
              type: "evidence_backed_behavior",
              dateOrPeriod: "2026",
              finding: "ผู้ใช้เริ่มใช้ AI เพื่อค้นหาข้อมูลธุรกิจ",
              thaiAudienceRelevance: "เกี่ยวข้องกับการค้นหาแบรนด์",
              brandRelevance: "เชื่อมกับหัวข้อ AI SEO",
              sourceTitle: "Thai Consumer Report",
              sourcePublisher: "Example Research",
              sourceDate: "2026-08-01",
              sourceUrl,
              proofType: "report",
              proofSummary: "รายงานระบุพฤติกรรมการใช้ AI search",
              brandSafety: "low_risk",
              evidenceStrength: "strong",
              confidenceScore: 90
            }
          ],
          insightCards: [
            {
              id: "insight-01",
              evidenceIds: ["ref-01"],
              evidence: "ผู้ใช้เริ่มใช้ AI เพื่อค้นหาข้อมูลธุรกิจ",
              tension: "ลูกค้าเปลี่ยนวิธีค้นหา แต่หลายแบรนด์ยังวัด visibility แบบเดิม",
              beliefChallenged: "ติดอันดับ Search เดิมแล้วลูกค้าจะหาแบรนด์เจอในทุกช่องทาง",
              humanConsequence: "เจ้าของธุรกิจอาจไม่เห็นช่วงที่ลูกค้าถาม AI แล้วเจอคู่แข่งแทน",
              brandConnection: "เชื่อมกับ Webinar ที่ช่วยตรวจและวางแผน AI visibility",
              freshnessReason: "เปลี่ยนจากการพูดเรื่อง SEO ทั่วไปเป็นช่องว่างการมองเห็นในคำตอบ AI",
              confidenceScore: 88
            }
          ],
          strongestInsightIds: ["insight-01"],
          strongestReferenceIds: ["ref-01"],
          researchGaps: [],
          researchLimitations: "",
          excluded: [],
          searchQueriesUsed: ["พฤติกรรม AI search ไทย 2026 report"]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          directions: [
            {
              id: "hook-01",
              sourceCandidateId: "direct-01",
              service: "single-static",
              hook: "ลูกค้าถาม AI แล้วเจอแบรนด์คุณไหม?",
              subheadline: "",
              concept: "Make AI visibility tangible",
              why: "Connects a current behavior with a business question",
              visual: "AI answer on a phone",
              cta: "จอง Webinar",
              supportingPoints: [],
              albumFormat: "three-horizontal",
              formatBeats: [],
              ugcBrief: null,
              ctaActionType: "other",
              ctaDestination: "",
              contactLine: "",
              caption: "ดูว่า AI มองเห็นแบรนด์อย่างไร",
              score: 86,
              reasoning: "Evidence-led and brand relevant",
              citations: [sourceUrl]
            }
          ]
        })
      );
    const writeDebugLog = vi.fn(
      async (_directory: string, _entry: HookGenerationDebugLog) => undefined
    );

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          runId: "research-run",
          hookIdeaMode: "fresh-research",
          generationModel: "gpt-5.6-terra",
          albumFormat: "auto",
          brand: {
            id: "convert-cake",
            name: "Convert Cake",
            category: "AI marketing agency"
          },
          service: "single-static",
          quantity: 1,
          contentTypeQuotas: [{ service: "single-static", count: 1 }],
          brief: "โปรโมต AI SEO webinar สำหรับธุรกิจไทย",
          onboardingQuestionnaire: "",
          extraInstructions: "",
          attachments: [],
          uploadedMaterials: [],
          brandMemory: { working: [], avoid: [] },
          brandLibrary: { brand: [], products: [], docs: [], refs: [] }
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        HOOK_GENERATION_DEBUG_LOG_DIR: "logs/hook-generation"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadAgentHookPrompt: async () => "# HOOK AGENT",
      loadHookResearchPrompt: async () => "# RESEARCH ONLY",
      loadSubheadlineHighlightPrompt: async () => "# HIGHLIGHT",
      writeDebugLog
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const researchBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; tool_choice?: string; text: { format: { name: string } } };
    expect(researchBody.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(researchBody.tool_choice).toBe("required");
    expect(researchBody.text.format.name).toBe("moons_hook_research");

    const hookBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { tools?: unknown[]; input: unknown; text: { format: { name: string } } };
    expect(hookBody.tools).toBeUndefined();
    expect(hookBody.text.format.name).toBe("moons_hook_generation");
    expect(JSON.stringify(hookBody.input)).toContain(sourceUrl);
    expect(JSON.stringify(hookBody.input)).toContain(
      "ลูกค้าเปลี่ยนวิธีค้นหา แต่หลายแบรนด์ยังวัด visibility แบบเดิม"
    );
    expect(JSON.stringify(hookBody.input)).toContain(
      "Start creative reasoning from the insightCards"
    );
    expect(JSON.stringify(hookBody.input)).toContain(
      "Dedicated Research Agent dossier"
    );

    expect(writeDebugLog).toHaveBeenCalledTimes(1);
    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
    expect(debugEntry?.researchAgent.request.responseSchema).toBe(
      "moons_hook_research"
    );
    expect(debugEntry?.hookAgent.batches[0]?.request.tools).toEqual([]);
  });
});
