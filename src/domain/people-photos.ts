export const PEOPLE_PHOTO_BUCKET = "creative-assets";
export const PEOPLE_PHOTO_FOLDER = "shared-people-photos";
export const PEOPLE_PHOTO_PREFIX = "Optional real person source — ";
export const PEOPLE_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const PEOPLE_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const peopleAgeBands = {
  unknown: "Unknown / not specified", under18: "Under 18 · เด็ก/วัยรุ่น", "18-24": "18–24 · วัยหนุ่มสาว", "25-34": "25–34 · วัยทำงาน", "35-44": "35–44 · วัยทำงาน", "45-59": "45–59 · วัยกลางคน", "60+": "60+ · ผู้สูงวัย", mixed: "Mixed ages · หลายช่วงวัย"
} as const;
export const peopleGenders = {
  unspecified: "Not specified", woman: "Woman / female · ผู้หญิง", man: "Man / male · ผู้ชาย", other: "Other / as described · ตามคำอธิบาย", mixed: "Mixed group · กลุ่มผสม"
} as const;
export interface PeopleCasting {
  ageBand: keyof typeof peopleAgeBands;
  gender: keyof typeof peopleGenders;
}
export const unknownPeopleCasting: PeopleCasting = { ageBand: "unknown", gender: "unspecified" };
export interface PeoplePhotoAnalysis {
  description: string;
  tags: readonly string[];
  apparentAgeBand: PeopleCasting["ageBand"];
}

export function readPeoplePhotoAnalysis(value: unknown): PeoplePhotoAnalysis {
  if (!value || typeof value !== "object") throw new Error("Invalid people-photo labels.");
  const record = value as Record<string, unknown>;
  if (typeof record.description !== "string" || record.description.length > 96 || !Array.isArray(record.tags) || record.tags.length > 6 ||
    !record.tags.every((tag) => typeof tag === "string" && tag.trim().length > 0 && tag.length <= 20) ||
    typeof record.apparentAgeBand !== "string" || !Object.hasOwn(peopleAgeBands, record.apparentAgeBand)) throw new Error("Invalid people-photo labels.");
  return { description: record.description.trim(), tags: [...new Set(record.tags.map((tag: string) => tag.trim()))], apparentAgeBand: record.apparentAgeBand as PeopleCasting["ageBand"] };
}

export interface PeoplePhotoDetails extends PeopleCasting { title: string; analysis?: PeoplePhotoAnalysis; }

export function peoplePhotoTitle(path: string): string {
  return peoplePhotoDetails(path).title;
}

export function peoplePhotoDetails(path: string): PeoplePhotoDetails {
  const encoded = path.split("--").slice(1).join("--") || path;
  if (/^v[123]_/.test(encoded)) {
    try {
      const raw = atob(encoded.slice(3).replace(/\.[^.]+$/, "").replaceAll("-", "+").replaceAll("_", "/"));
      const decoded = new TextDecoder().decode(Uint8Array.from(raw, (character) => character.charCodeAt(0)));
      if (encoded.startsWith("v1_")) return { title: decoded, ...unknownPeopleCasting };
      const data: unknown = JSON.parse(decoded);
      if (data && typeof data === "object" && "title" in data && typeof data.title === "string") {
        const ageBand = "ageBand" in data && typeof data.ageBand === "string" && Object.hasOwn(peopleAgeBands, data.ageBand) ? data.ageBand as PeopleCasting["ageBand"] : "unknown";
        const gender = "gender" in data && typeof data.gender === "string" && Object.hasOwn(peopleGenders, data.gender) ? data.gender as PeopleCasting["gender"] : "unspecified";
        let analysis: PeoplePhotoAnalysis | undefined;
        if ("analysis" in data) { try { analysis = readPeoplePhotoAnalysis(data.analysis); } catch { /* Ignore invalid labels while retaining known casting metadata. */ } }
        return { title: data.title, ageBand, gender, ...(analysis ? { analysis } : {}) };
      }
    } catch { /* Legacy/unrecognized names remain readable without invented casting facts. */ }
  }
  try { return { title: decodeURIComponent(encoded), ...unknownPeopleCasting }; }
  catch { return { title: encoded, ...unknownPeopleCasting }; }
}

export function peoplePhotoPath(title: string, mimeType: string, casting?: PeopleCasting, analysis?: PeoplePhotoAnalysis): string {
  const shortTitle = Array.from(title).slice(0, analysis ? 80 : 140).join("");
  const value = analysis ? JSON.stringify({ title: shortTitle, ...(casting ?? unknownPeopleCasting), analysis: readPeoplePhotoAnalysis(analysis) }) : casting ? JSON.stringify({ title: shortTitle, ...casting }) : shortTitle;
  const bytes = new TextEncoder().encode(value);
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const path = `${PEOPLE_PHOTO_FOLDER}/${crypto.randomUUID()}--${analysis ? "v3" : casting ? "v2" : "v1"}_${encoded}.${mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg"}`;
  if (path.length > 1000) throw new Error("Photo title and labels are too long. Shorten the description or labels.");
  return path;
}

export function peoplePhotoSourceLabel(path: string): string {
  const details = peoplePhotoDetails(path);
  const age = details.ageBand === "unknown" && details.analysis
    ? `Apparent age band (AI estimate, not actual age): ${peopleAgeBands[details.analysis.apparentAgeBand]}`
    : `Age band (team-provided): ${peopleAgeBands[details.ageBand]}`;
  return `${PEOPLE_PHOTO_PREFIX}${details.title} · ${age} · Gender (team-provided): ${peopleGenders[details.gender]}${details.analysis ? ` · Visual description: ${details.analysis.description} · Labels: ${details.analysis.tags.join(", ")}` : ""}`;
}

export const PEOPLE_FREE_IMAGE_INSTRUCTION = "HUMAN PRESENCE LOCK: NO PEOPLE. The visual planner selected no People photo. Render a human-free composition: no people, faces, hands, human body parts or human silhouettes. Do not introduce a person from a style reference or invent an AI person, even if the headline mentions children, parents or customers. Communicate the idea through the product, typography and non-human visual elements. This decision overrides any ambiguous human action in the creative description.";

export function buildPeoplePhotoInstruction(labels: readonly string[], forImageGeneration = false): string {
  const photos = labels.flatMap((label, index) => label.startsWith(PEOPLE_PHOTO_PREFIX)
    ? [`Image ${index + 1}: ${label}`] : []);
  if (!photos.length) return "";
  if (forImageGeneration) return [
    "REAL PERSON SOURCE PHOTOS",
    "Follow the visual mechanism/design grammar's decision about human presence. Use supplied real-person photos for the planned human roles instead of replacing them with generic AI faces. Use the face as the identity anchor, not a pixel-preserving cutout. Rebuild the pose, gestures, body orientation, wardrobe, hair styling, expression, makeup, camera perspective, setting and lighting to serve the approved idea. Preserve recognizable facial structure and distinctive facial traits with believable anatomy; the source body pose, clothes and lighting are not requirements. Integrate the person with consistent scene perspective, light direction, color temperature, shadows and contact shadows so the artwork feels like one real shoot, never a pasted-in portrait. Every visible person must be grounded in a selected real-person source; do not invent additional AI people. Do not add extra people or force human presence into a human-free idea. Ignore unsuitable optional photos.",
    "These photos are identity sources only, not campaign products, brand identity, scene/background requirements or new visible copy. Do not import incidental products, logos or words from them.",
    ...photos
  ].join("\n");
  return [
    "OPTIONAL REAL PEOPLE PHOTO LIBRARY",
    "The supplied people photos are optional casting sources shared across brands, not mandatory subjects, products, style references or evidence for campaign claims. Decide whether a person actually strengthens visualMechanism/campaignIdea before choosing any photo. A human-free execution is fully valid; never add people just because these photos are attached.",
    "Use team-provided age/gender metadata for casting compatibility. AI apparent-age bands are visual estimates, not actual ages; team-provided age bands take priority. Unknown/not-specified values are missing information, not confirmed matches. Do not infer gender identity or actual age from appearance. Visible pose, wardrobe, lighting, setting and activities may inform compositional fit.",
    "If people serve the idea, select a supplied photo with a compatible person and use that actual person as the visual source instead of inventing a generic AI face. Match the person to the casting, not the original pose, wardrobe, setting or props: these may change to execute the idea. Do not reject a suitable person just because the source photo does not already show the planned action. Treat the face as the identity anchor only. Art-direct a new pose, gesture, outfit, hair styling, expression, makeup and camera angle for the idea while preserving recognizable facial structure and distinctive facial traits. Plan the person and the scene as one shoot with coherent lighting, perspective and shadows, not a cutout pasted into a new background. The original outfit, body pose and light direction must not constrain the new execution. Do not copy unrelated products, branding, backgrounds or words from these photos. If no person fits the casting, redesign the execution without people rather than inventing a replacement person.",
    "During planning, decide human presence in visualMechanism/conceptTranslation. If the execution depicts any person, return at least one chosen source image number in peoplePhotoImages. Return an empty array when none fits or no person is needed, and then make visualMechanism/conceptTranslation explicitly human-free. Never describe a visible child/person performing an action while returning an empty array. Only optional people-photo sources may appear in this array. Refer to the people by description, not image number, in prose. The final artwork must follow that decision, not use every candidate.",
    ...photos
  ].join("\n");
}

export function selectPeoplePhotoNames(names: readonly string[], context: string, limit = 6): readonly string[] {
  const words = new Set(context.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2));
  const woman = /\b(?:woman|women|female)\b|ผู้หญิง|เพศหญิง|(?:^|\s)หญิง(?:\s|$)/i.test(context);
  const man = /\b(?:man|men|male)\b|ผู้ชาย|เพศชาย|(?:^|\s)ชาย(?:\s|$)/i.test(context);
  const gender = woman !== man ? woman ? "woman" : "man" : null;
  const requestedAge = /(?:\bage(?:d)?|อายุ)\s*(\d{1,2})(?:\s*(?:[-–]|ถึง|to)\s*(\d{1,2}))?/i.exec(context);
  const childCasting = /เด็ก|เจ้าตัวเล็ก|ลูกเล็ก|\b(?:children|child|kids?|toddlers?|bab(?:y|ies))\b/i.test(context);
  return names.map((name, index) => {
    const metadata = peoplePhotoDetails(name);
    const text = peoplePhotoSourceLabel(name).toLowerCase();
    let score = [...words].filter((word) => /^[a-z0-9]+$/.test(word) ? new RegExp(`\\b${word}\\b`).test(text) : text.includes(word)).length;
    score += (metadata.analysis?.tags ?? []).filter((tag) => /[^\x00-\x7F]/.test(tag) && tag.length >= 2 && context.includes(tag)).length * 2;
    if (gender && metadata.gender !== "unspecified") score += metadata.gender === gender ? 4 : -4;
    const ageBand = metadata.ageBand !== "unknown" ? metadata.ageBand : metadata.analysis?.apparentAgeBand ?? "unknown";
    if (!requestedAge && childCasting && ageBand !== "unknown" && ageBand !== "mixed") score += ageBand === "under18" ? 6 : -2;
    if (requestedAge && ageBand !== "unknown" && ageBand !== "mixed") {
      const range = ageBand === "under18" ? [0, 17] : ageBand === "60+" ? [60, 120] : ageBand.split("-").map(Number);
      const low = Number(requestedAge[1]);
      const high = Number(requestedAge[2] ?? requestedAge[1]);
      score += range[0]! <= high && range[1]! >= low ? 4 : -4;
    }
    return { name, index, score };
  })
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((item) => item.name);
}
