import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  CREATIVE_STRATEGIST_AGENT_NAME,
  CS_QUALITY_CHECKLIST,
  GD_CREATIVE_STRATEGIST_CHECKLIST,
  type CreativeQualityReport,
  type QualityAreaResult
} from "../../domain/quality-check.js";

type FetchLike = typeof fetch;

type ResponseContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };

export interface QualityCheckEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_QUALITY_CHECK_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface QualityCheckEndpointOptions {
  request: Request;
  env: QualityCheckEndpointEnv;
  fetchImpl?: FetchLike;
}

interface QualityCheckOutputInput {
  id: string;
  hook: string;
  subheadline: string;
  concept: string;
  visual: string;
  cta: string;
  caption: string;
  revisionFeedback: string;
  assetUrl: string;
}

interface QualityCheckBrandContext {
  name: string;
  category: string;
  brandKit: readonly string[];
  products: readonly string[];
  documents: readonly string[];
  working: readonly string[];
  avoid: readonly string[];
}

interface QualityCheckReferenceImage {
  label: string;
  url: string;
  kind: "brand-kit" | "creative-reference";
}

interface QualityCheckRequest {
  runId: string;
  brief: string;
  brandContext: QualityCheckBrandContext | null;
  referenceImages: readonly QualityCheckReferenceImage[];
  outputs: readonly QualityCheckOutputInput[];
}

interface QualityCheckResult {
  outputId: string;
  gdPassed: boolean;
  gdReason: string;
  csPassed: boolean;
  csReason: string;
  passed: boolean;
  reason: string;
  report: CreativeQualityReport;
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function handleQualityCheckRequest({
  request,
  env,
  fetchImpl = fetch
}: QualityCheckEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return jsonResponse(
        { ok: false, error: "OPENAI_API_KEY is required." },
        500
      );
    }

    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const input = parseRequestBody(await request.json());
    if (!input.outputs.length) {
      return jsonResponse({ ok: true, results: [] });
    }

    const model = env.OPENAI_QUALITY_CHECK_MODEL?.trim() || DEFAULT_MODEL;
    const payload = await callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      content: await buildContent(input, fetchImpl)
    });
    const results = parseResults(extractResponseText(payload), input.outputs);

    return jsonResponse({ ok: true, results });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function callResponsesApi({
  apiKey,
  model,
  fetchImpl,
  content
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  content: readonly ResponseContent[];
}): Promise<unknown> {
  const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "moons_quality_check",
          strict: true,
          schema: resultsSchema
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await readProviderErrorDetail(response);
    throw new Error(
      `OpenAI quality check failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  return readJsonResponse(response, "OpenAI quality check");
}

async function buildContent(
  input: QualityCheckRequest,
  fetchImpl: FetchLike
): Promise<readonly ResponseContent[]> {
  const content: ResponseContent[] = [
    {
      type: "input_text",
      text: [
        `Agent name: ${CREATIVE_STRATEGIST_AGENT_NAME}`,
        "คุณคือ Creative Strategist & QA ตรวจ Facebook image ads จากมุมมอง first-time scroller แบบตรงไปตรงมา กระชับ ไม่อวยแบรนด์ และโฟกัส Bottom Funnel action ได้แก่ lead, purchase, add-to-cart หรือ app install",
        "โจทย์ผู้ใช้: ตรวจภาพตาม Checklist ให้ครบ แต่สรุปเฉพาะจุดที่ต้องรู้และต้องแก้จริง พร้อมคะแนนและคำแนะนำที่นำไปใช้ได้ทันที",
        "วิเคราะห์ภายในโดยไม่เปิดเผย reasoning steps: ทำความเข้าใจสินค้าและเป้าหมาย วิเคราะห์ Visual/Copy/Claim/Persona/CTA/Offer/Urgency/Brand/Social proof/Policy risk แล้วจัดลำดับ conversion blockers ก่อนตอบ",
        "",
        "GD Checklist Review — ต้องประเมินครบทุกข้อและเรียงตามลำดับ แต่ใช้ข้อความย่อ",
        ...GD_CREATIVE_STRATEGIST_CHECKLIST.map((item) => `- ${item}`),
        "",
        "CS Checklist",
        ...CS_QUALITY_CHECKLIST.map((item) => `- ${item}`),
        "",
        "กติกาการตรวจ:",
        "- First Impression: ตรวจ Visual Hook, Initial Text Focus และ Desire to Purchase จากสิ่งที่เห็นใน 1 วินาทีแรก",
        "- Stop-scroll & Brand Impact Audit เป็นข้อบังคับ: ถามตรง ๆ ว่า ‘ภาพนี้ดีพอให้กลุ่มเป้าหมายหยุดดูและทำให้แบรนด์ได้รับความสนใจในทางบวกหรือไม่ หรือเสี่ยงสร้างภาพลบให้แบรนด์?’ ประเมินจากภาพจริงที่ขนาด mobile feed โดยดูความโดดเด่น ความเข้าใจได้ใน 1 วินาที ความเฉพาะของแบรนด์ ความน่าเชื่อถือ ความอยากดูต่อ และความรู้สึกว่าเป็นงานที่ผ่านการออกแบบอย่างตั้งใจ",
        "- ผล Stop-scroll & Brand Impact Audit ต้องขึ้นต้น detail ด้วย ‘Stop-scroll verdict: Strong’ หรือ ‘Stop-scroll verdict: Weak’ และตามด้วย ‘Brand perception: Positive’, ‘Brand perception: Neutral’ หรือ ‘Brand perception: Risk’ พร้อมหลักฐานที่เห็นจริง; passed=true ได้เฉพาะเมื่อ Stop-scroll เป็น Strong และ Brand perception ไม่เป็น Risk",
        "- ถ้า Stop-scroll อ่อนหรือเสี่ยงต่อแบรนด์จากงานที่ดู AI, cheap, generic, cluttered, misleading หรือไม่เป็นมืออาชีพ: gd.passed ต้องเป็น false, suggestion ต้องระบุการเปลี่ยน visual hook, hierarchy, crop, typography, branding หรือ production finish ที่แก้ได้จริง และต้องใส่ไว้ใน Top 3 Actionable Recs",
        "- ห้ามสรุปว่า AI ทำให้แบรนด์เสียหายเพียงเพราะทราบว่าใช้ AI ให้ตัดสินเฉพาะสิ่งที่ผู้ชมมองเห็นได้จริงและผลต่อความน่าเชื่อถือของงาน",
        "- Design Principle Audit เป็นข้อบังคับ: ตรวจ Balance, Contrast, Emphasis, Movement, Dominance, Pattern, Rhythm, Unity, Variety, Proportion, Scale และ Space รวมถึง hierarchy, alignment, proximity, grid และ quiet zone โดยตัดสินจากภาพจริงบนหน้าจอมือถือ ไม่ใช่จากคำอธิบาย concept",
        "- Lighting & Material Audit เป็นข้อบังคับ: ตรวจทิศทางและอุณหภูมิแสง, contact shadow, ambient occlusion, reflection, highlight, texture, depth, perspective, edge integration และการตอบสนองของวัสดุให้สัมพันธ์กันทั้งภาพ",
        "- AI-origin Audit เป็นข้อบังคับ: ถามตรง ๆ ว่า ‘งานนี้ดูออกว่าทำจาก AI หรือไม่?’ แล้วตอบในเกณฑ์ AI-origin Audit โดย passed=true หมายถึงไม่พบร่องรอย AI ที่ชัดเจน และ passed=false หมายถึงเห็นร่องรอยที่พิสูจน์ได้จากภาพ",
        "- ร่องรอย AI ที่ต้องตรวจ ได้แก่ geometry หรือ perspective ผิดธรรมชาติ, แสงเงาขัดกัน, วัตถุลอย, ขอบละลาย, anatomy ผิด, texture/lายซ้ำ, วัสดุพลาสติกหรือเงาวาวเกินจริง, ข้อความ/โลโก้บิด, fake UI, วัตถุที่ดูถูกมโนขึ้น, generic glossy CGI, glow มากเกินไป และรายละเอียดแน่นแต่ไม่มีระบบ",
        "- ห้ามตัดสินว่าเป็น AI เพียงเพราะใช้ 3D, illustration หรือภาพ stylized ต้องระบุ visual evidence ที่มองเห็นได้จริงเสมอ",
        "- ถ้า AI-origin Audit ไม่ผ่าน: gd.passed ต้องเป็น false, detail ต้องขึ้นต้นด้วย ‘AI-origin verdict: Looks AI-generated’ พร้อมหลักฐานสั้น ๆ และ suggestion ต้องระบุวิธี retouch/composite/relight/rebuild ที่แก้ได้จริง โดยใส่ anti-AI fix ไว้ใน Top 3 Actionable Recs",
        "- ถ้า AI-origin Audit ผ่าน: detail ต้องขึ้นต้นด้วย ‘AI-origin verdict: Not obviously AI-generated’ และอธิบายหลักฐานสั้น ๆ โดย suggestion เป็นสตริงว่าง",
        "- ถ้างานภาพแน่น อ่านยาก หรือขาด quiet zone ให้เสนอการลด/ย้าย/ย่อองค์ประกอบก่อนเสนอเพิ่มข้อความหรือของตกแต่ง งานต้อง image-led และอ่านได้บนมือถือ",
        "- Bottom Funnel: ตรวจ Target Persona Fit, CTA Clarity, Urgency/Scarcity, Brand Recognition & Trust และความพร้อมให้เกิด action",
        "- Claim Accuracy Check เป็นข้อบังคับ: ตรวจทุกเคลมด้านประโยชน์ ผลลัพธ์ เวลา การเปรียบเทียบ การรับรอง สุขภาพ และตัวเลข เทียบเฉพาะหลักฐานที่ให้มา พร้อมธงเกินจริง กำกวม เสี่ยงนโยบาย หรือควรมี disclaimer",
        "- ถ้าเคลมไม่มีหลักฐาน ให้เสนอหลักฐานที่ควรเพิ่มหรือถ้อยคำที่ปลอดภัยและแม่นยำกว่า ห้ามปฏิเสธลอย ๆ",
        "- ตรวจ GD จากองค์ประกอบ ลำดับสายตา ความประณีต ความสมจริงของภาพ Gen AI และความถูกต้องของสิ่งที่เทียบได้กับ Brand Context/Reference Images",
        "- ตรวจ CS โดยเทียบ Artwork, Hook, Subheadline, Concept, CTA และ Caption กับ Brief / Objective / Client Context / Revision Feedback",
        "- ถ้ามี Mockup หรือ Reference Image ให้ตรวจว่างาน Final พัฒนาต่อและไม่ดูแบนหรือเป็น Template เกินไป ถ้าไม่มีหลักฐานเปรียบเทียบ ห้ามตัดสินตกเฉพาะข้อนี้",
        "- ตรวจ Logo, Brand CI, ชื่อแบรนด์/สินค้า ราคา โปรโมชัน และรายละเอียดจากข้อมูลที่ให้มาเท่านั้น ห้ามเดาหรือสร้างข้อเท็จจริงเพิ่ม",
        "- ถ้าไม่มี Revision Feedback ให้ถือว่าข้อ Revision ผ่านโดยไม่มีสิ่งให้เทียบ",
        "- ตรวจทุกเกณฑ์ภายในให้ครบ แต่ผลลัพธ์สำหรับ UI ต้องสั้นและไม่ซ้ำกัน",
        "- เกณฑ์ที่ผ่าน: detail เป็นหลักฐานสั้น ๆ เพียง 1 วลี และ suggestion เป็นสตริงว่าง",
        "- เกณฑ์ที่ไม่ผ่าน: detail ระบุปัญหาที่เห็นจริงไม่เกิน 1 ประโยค และ suggestion ระบุวิธีแก้ที่ทำตามได้ทันทีไม่เกิน 1 ประโยค",
        "- summary ระดับ GD, CS และภาพรวมต้องมีเพียง 1 ประโยคสั้น ห้ามสรุปซ้ำกับ suggestion.detail",
        "- ห้ามเขียนบทนำ คำชมยาว เหตุผลซ้ำ หรือย่อหน้าวิเคราะห์เพิ่มเติมในทุก field",
        "- gd.passed ต้องเป็น true เมื่อไม่มีปัญหา GD ที่พิสูจน์ได้ และ cs.passed ต้องเป็น true เมื่อไม่มีปัญหา CS ที่พิสูจน์ได้",
        "- ให้คะแนนทุกเกณฑ์และคะแนนรวมตั้งแต่ 0-100 โดยอิงหลักฐานที่เห็นจริง",
        `- agentName ต้องเป็น "${CREATIVE_STRATEGIST_AGENT_NAME}" เท่านั้น`,
        `- ส่งผล GD ตามลำดับ Checklist ทั้ง ${GD_CREATIVE_STRATEGIST_CHECKLIST.length} ข้อ และ CS ทั้ง ${CS_QUALITY_CHECKLIST.length} ข้อเพื่อคงโครงข้อมูล แต่แต่ละข้อใช้ข้อความย่อตามกติกาด้านบน`,
        "- ถ้างานต้องแก้ ให้ suggestion.title เป็น conversion blocker ที่สำคัญที่สุดแบบสั้น ๆ และ suggestion.detail มีเฉพาะ Top 3 Actionable Recs เรียง 1-3 แยกบรรทัด บรรทัดละ 1 วิธีแก้สั้น ๆ ห้ามอธิบายซ้ำ",
        "- suggestedHook ให้เป็น Hook ที่แข็งแรงที่สุดจาก 3 แนวทาง Pain Point, Desired Result และ Urgency เมื่อปัญหาเกี่ยวกับข้อความ มิฉะนั้นให้เป็นสตริงว่าง",
        "- ถ้างานผ่าน ให้ suggestion.title, suggestion.detail และ suggestion.suggestedHook เป็นสตริงว่าง",
        "",
        `Brief: ${input.brief}`,
        `Brand Context:\n${formatBrandContext(input.brandContext)}`,
        "",
        "แต่ละภาพจะมี outputId กำกับไว้ ให้ตอบกลับด้วย outputId เดียวกันทุกรายการ"
      ].join("\n")
    }
  ];

  for (const reference of input.referenceImages) {
    const imageUrl = await resolveOptionalReferenceImageUrlForVision(
      reference.url,
      reference.label,
      fetchImpl
    );
    content.push({
      type: "input_text",
      text: imageUrl
        ? `Reference Image (${reference.kind}) — ${reference.label}. ใช้เพื่อเปรียบเทียบเท่านั้น ไม่ใช่ Artwork ที่ต้องให้คะแนน`
        : `Reference Image (${reference.kind}) — ${reference.label}. ข้ามภาพนี้เพราะ backend ดาวน์โหลดไม่ได้ ให้ตรวจต่อจาก references อื่นและข้อมูลที่มี ห้าม fail งานเพราะ reference นี้หาย`
    });
    if (imageUrl) {
      content.push({
        type: "input_image",
        image_url: imageUrl,
        detail: "auto"
      });
    }
  }

  for (const output of input.outputs) {
    content.push({
      type: "input_text",
      text: [
        `outputId: ${output.id}`,
        `Hook: ${output.hook}`,
        `Subheadline: ${output.subheadline}`,
        `Concept: ${output.concept}`,
        `Visual direction: ${output.visual}`,
        `CTA: ${output.cta}`,
        `Caption: ${output.caption}`,
        `Revision Feedback: ${output.revisionFeedback || "ไม่มี"}`
      ].join("\n")
    });
    content.push({
      type: "input_image",
      image_url: await resolveImageUrlForVision(
        output.assetUrl,
        `creative "${output.id}"`,
        fetchImpl
      ),
      detail: "auto"
    });
  }

  content.push({ type: "input_text", text: "Return only JSON ตาม schema." });

  return content;
}

async function resolveOptionalReferenceImageUrlForVision(
  url: string,
  label: string,
  fetchImpl: FetchLike
): Promise<string | null> {
  try {
    return await resolveImageUrlForVision(
      url,
      `reference image "${label}"`,
      fetchImpl
    );
  } catch {
    return null;
  }
}

async function resolveImageUrlForVision(
  url: string,
  label: string,
  fetchImpl: FetchLike
): Promise<string> {
  if (url.startsWith("data:")) return url;

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Could not download ${label}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "image/png";
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `Could not use ${label}: expected image content, got ${contentType}.`
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

const resultsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          outputId: { type: "string" },
          agentName: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          summary: { type: "string" },
          gd: qualityAreaSchema(GD_CREATIVE_STRATEGIST_CHECKLIST.length),
          cs: qualityAreaSchema(CS_QUALITY_CHECKLIST.length),
          suggestion: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              detail: { type: "string" },
              suggestedHook: { type: "string" }
            },
            required: ["title", "detail", "suggestedHook"]
          }
        },
        required: ["outputId", "agentName", "score", "summary", "gd", "cs", "suggestion"]
      }
    }
  },
  required: ["results"]
} as const;

function qualityAreaSchema(criteriaCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      passed: { type: "boolean" },
      score: { type: "integer", minimum: 0, maximum: 100 },
      summary: { type: "string" },
      criteria: {
        type: "array",
        minItems: criteriaCount,
        maxItems: criteriaCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            passed: { type: "boolean" },
            score: { type: "integer", minimum: 0, maximum: 100 },
            detail: { type: "string" },
            suggestion: { type: "string" }
          },
          required: ["passed", "score", "detail", "suggestion"]
        }
      }
    },
    required: ["passed", "score", "summary", "criteria"]
  } as const;
}

function parseResults(
  text: string,
  outputs: readonly QualityCheckOutputInput[]
): readonly QualityCheckResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return outputs.map((output) => ({
      outputId: output.id,
      gdPassed: false,
      gdReason:
        "Quality agent returned malformed JSON. Re-run quality check after confirming the artwork image is accessible.",
      csPassed: false,
      csReason:
        "Quality agent returned malformed JSON. Re-run quality check after confirming the artwork image is accessible.",
      passed: false,
      reason:
        "GD ต้องแก้: Quality agent returned malformed JSON. Re-run quality check after confirming the artwork image is accessible.\nCS ต้องแก้: Quality agent returned malformed JSON. Re-run quality check after confirming the artwork image is accessible.",
      report: malformedQualityReport()
    }));
  }
  const value = readRecord(parsed, "quality check payload");
  if (!Array.isArray(value.results)) {
    throw new Error("results must be an array.");
  }

  const validIds = new Set(outputs.map((output) => output.id));
  return value.results
    .map((item, index) => {
      const record = readRecord(item, `results[${index}]`);
      const gd = parseQualityArea(
        record.gd,
        `results[${index}].gd`,
        GD_CREATIVE_STRATEGIST_CHECKLIST
      );
      const cs = parseQualityArea(
        record.cs,
        `results[${index}].cs`,
        CS_QUALITY_CHECKLIST
      );
      const suggestionRecord = readRecord(
        record.suggestion,
        `results[${index}].suggestion`
      );
      const suggestion = {
        title: readString(
          suggestionRecord.title,
          `results[${index}].suggestion.title`
        ),
        detail: readString(
          suggestionRecord.detail,
          `results[${index}].suggestion.detail`
        ),
        suggestedHook: readString(
          suggestionRecord.suggestedHook,
          `results[${index}].suggestion.suggestedHook`
        )
      };
      const score = readScore(record.score, `results[${index}].score`);
      const summary = readString(record.summary, `results[${index}].summary`);
      const gdPassed = gd.passed;
      const csPassed = cs.passed;
      const gdReason = gd.summary;
      const csReason = cs.summary;
      return {
        outputId: readString(record.outputId, `results[${index}].outputId`),
        gdPassed,
        gdReason,
        csPassed,
        csReason,
        passed: gdPassed && csPassed,
        reason: [
          `GD ${gdPassed ? "ผ่าน" : "ต้องแก้"}: ${gdReason}`,
          `CS ${csPassed ? "ผ่าน" : "ต้องแก้"}: ${csReason}`
        ].join("\n"),
        report: {
          agentName: readString(
            record.agentName,
            `results[${index}].agentName`
          ),
          score,
          summary,
          gd,
          cs,
          suggestion
        }
      };
    })
    .filter((result) => validIds.has(result.outputId));
}

function parseQualityArea(
  value: unknown,
  field: string,
  checklist: readonly string[]
): QualityAreaResult {
  const record = readRecord(value, field);
  if (!Array.isArray(record.criteria)) {
    throw new Error(`${field}.criteria must be an array.`);
  }
  if (record.criteria.length !== checklist.length) {
    throw new Error(`${field}.criteria must contain ${checklist.length} items.`);
  }

  const declaredPassed = readBoolean(record.passed, `${field}.passed`);
  const criteria = record.criteria.map((item, index) => {
    const criterion = readRecord(item, `${field}.criteria[${index}]`);
    return {
      criterion: checklist[index]!,
      passed: readBoolean(
        criterion.passed,
        `${field}.criteria[${index}].passed`
      ),
      score: readScore(
        criterion.score,
        `${field}.criteria[${index}].score`
      ),
      detail: readString(
        criterion.detail,
        `${field}.criteria[${index}].detail`
      ),
      suggestion: readString(
        criterion.suggestion,
        `${field}.criteria[${index}].suggestion`
      )
    };
  });

  return {
    passed: declaredPassed && criteria.every((criterion) => criterion.passed),
    score: readScore(record.score, `${field}.score`),
    summary: readString(record.summary, `${field}.summary`),
    criteria
  };
}

function malformedQualityReport(): CreativeQualityReport {
  const message =
    "Quality agent returned malformed JSON. Re-run quality check after confirming the artwork image is accessible.";
  const area = (checklist: readonly string[]): QualityAreaResult => ({
    passed: false,
    score: 0,
    summary: message,
    criteria: checklist.map((criterion) => ({
      criterion,
      passed: false,
      score: 0,
      detail: message,
      suggestion: "Re-run quality check."
    }))
  });
  return {
    agentName: CREATIVE_STRATEGIST_AGENT_NAME,
    score: 0,
    summary: message,
    gd: area(GD_CREATIVE_STRATEGIST_CHECKLIST),
    cs: area(CS_QUALITY_CHECKLIST),
    suggestion: {
      title: "Re-run quality check",
      detail: message,
      suggestedHook: ""
    }
  };
}

function parseRequestBody(value: unknown): QualityCheckRequest {
  if (!isRecord(value)) throw new Error("Invalid quality check request.");

  const runId = readString(value.runId, "runId");
  const brief = readString(value.brief, "brief");
  if (!Array.isArray(value.outputs)) {
    throw new Error("outputs must be an array.");
  }

  return {
    runId,
    brief,
    brandContext: parseBrandContext(value.brandContext),
    referenceImages: parseReferenceImages(value.referenceImages),
    outputs: value.outputs.map((item, index) => {
      const record = readRecord(item, `outputs[${index}]`);
      return {
        id: readString(record.id, `outputs[${index}].id`),
        hook: readString(record.hook, `outputs[${index}].hook`),
        subheadline: readOptionalString(record.subheadline),
        concept: readString(record.concept, `outputs[${index}].concept`),
        visual: readString(record.visual, `outputs[${index}].visual`),
        cta: readOptionalString(record.cta),
        caption: readOptionalString(record.caption),
        revisionFeedback: readOptionalString(record.revisionFeedback),
        assetUrl: readString(record.assetUrl, `outputs[${index}].assetUrl`)
      };
    })
  };
}

function formatBrandContext(context: QualityCheckBrandContext | null): string {
  if (!context) return "ไม่มี Brand Context";

  return [
    `Brand: ${context.name}`,
    `Category: ${context.category}`,
    `Brand kit: ${formatList(context.brandKit)}`,
    `Products: ${formatList(context.products)}`,
    `Client documents: ${formatList(context.documents)}`,
    `What works: ${formatList(context.working)}`,
    `Avoid: ${formatList(context.avoid)}`
  ].join("\n");
}

function formatList(items: readonly string[]): string {
  return items.length ? items.join(" | ") : "ไม่มีข้อมูล";
}

function parseBrandContext(value: unknown): QualityCheckBrandContext | null {
  if (value === undefined || value === null) return null;
  const record = readRecord(value, "brandContext");
  return {
    name: readOptionalString(record.name),
    category: readOptionalString(record.category),
    brandKit: readStringArray(record.brandKit, "brandContext.brandKit"),
    products: readStringArray(record.products, "brandContext.products"),
    documents: readStringArray(record.documents, "brandContext.documents"),
    working: readStringArray(record.working, "brandContext.working"),
    avoid: readStringArray(record.avoid, "brandContext.avoid")
  };
}

function parseReferenceImages(
  value: unknown
): readonly QualityCheckReferenceImage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("referenceImages must be an array.");

  return value.map((item, index) => {
    const record = readRecord(item, `referenceImages[${index}]`);
    const kind = readString(record.kind, `referenceImages[${index}].kind`);
    if (kind !== "brand-kit" && kind !== "creative-reference") {
      throw new Error(`referenceImages[${index}].kind is invalid.`);
    }
    return {
      label: readString(record.label, `referenceImages[${index}].label`),
      url: readString(record.url, `referenceImages[${index}].url`),
      kind
    };
  });
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => readString(item, `${field}[${index}]`));
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI quality check response did not include output text.");
  }

  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  throw new Error("OpenAI quality check response did not include output text.");
}

async function readProviderErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return "";

  let detail = text;
  try {
    const payload = JSON.parse(text) as unknown;
    if (isRecord(payload)) {
      if (typeof payload.message === "string") {
        detail = payload.message;
      } else if (typeof payload.error === "string") {
        detail = payload.error;
      } else if (
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
      ) {
        detail = payload.error.message;
      }
    }
  } catch {
    // Plain-text provider errors are already safe to summarize below.
  }

  return detail.replace(/\s+/g, " ").trim().slice(0, 300);
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

function readScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number.`);
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function readableError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown quality check error.";
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}
