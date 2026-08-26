import type { CreativeQualityReport } from "./quality-check";

export const creativeStages = [
  "start",
  "brief",
  "directions",
  "studio",
  "approval",
  "client",
  "summary"
] as const;

export type CreativeStage = (typeof creativeStages)[number];

export const serviceTypes = [
  "single-static",
  "album-post",
  "motion-static",
  "resize",
  "ugc-video"
] as const;

export type ServiceType = (typeof serviceTypes)[number];

export const albumFormats = [
  "three-vertical",
  "three-horizontal",
  "four-vertical",
  "four-grid"
] as const;
export type AlbumFormat = (typeof albumFormats)[number];
export const albumFormatPreferences = ["auto", ...albumFormats] as const;
export type AlbumFormatPreference = (typeof albumFormatPreferences)[number];
export const defaultAlbumFormat: AlbumFormat = "three-horizontal";
export const defaultAlbumFormatPreference: AlbumFormatPreference = "auto";

export function resolveAlbumFormat(
  preference: AlbumFormatPreference,
  suggested?: AlbumFormat
): AlbumFormat {
  return preference === "auto" ? suggested ?? defaultAlbumFormat : preference;
}

export function albumFormatPanelCount(format: AlbumFormat): 3 | 4 {
  return format.startsWith("three-") ? 3 : 4;
}

export function albumFormatLabel(format: AlbumFormat): string {
  switch (format) {
    case "three-vertical":
      return "3 images · Vertical lead";
    case "three-horizontal":
      return "3 images · Horizontal lead";
    case "four-vertical":
      return "4 images · Vertical lead";
    case "four-grid":
      return "4 images · Grid";
  }
}

export function outputFormatForService(service: ServiceType): string {
  switch (service) {
    case "single-static":
      return "1:1 Static";
    case "album-post":
      return "Album post";
    case "motion-static":
      return "Motion static";
    case "resize":
      return "Resize";
    case "ugc-video":
      return "9:16 UGC";
  }
}

export function normalizeFormatBeatsForService(
  service: ServiceType | undefined,
  beats: readonly string[] | undefined
): readonly string[] {
  if (service === "single-static" || service === "resize") return [];
  return (beats ?? []).map((beat) => beat.trim()).filter(Boolean);
}
export const artworkModes = [
  "standard",
  "design-system",
  "design-system-new",
  "direct-final-artwork",
  "reference-library"
] as const;
export type ArtworkMode = (typeof artworkModes)[number];

// Product rollout switches live here so modes can be hidden without removing
// their persisted-data and API compatibility. Add a mode back to this list to
// expose it in every artwork-mode selector again.
export const userSelectableArtworkModes = [
  "standard",
  "design-system",
  "design-system-new",
  "direct-final-artwork"
] as const satisfies readonly ArtworkMode[];
export type UserSelectableArtworkMode =
  (typeof userSelectableArtworkModes)[number];
export const defaultArtworkMode: UserSelectableArtworkMode = "standard";

export function isUserSelectableArtworkMode(
  mode: ArtworkMode
): mode is UserSelectableArtworkMode {
  return (userSelectableArtworkModes as readonly ArtworkMode[]).includes(mode);
}

export function normalizeUserSelectableArtworkMode(
  mode: ArtworkMode
): UserSelectableArtworkMode {
  return isUserSelectableArtworkMode(mode) ? mode : defaultArtworkMode;
}

// Temporary rollout switch for post-generation visual QC. Keep the mode list
// below intact so the capability can be restored without rebuilding the
// pipeline; flip this flag only after QC is ready to be enabled again.
export const postGenerationVisualQcEnabled = false;

// Post-generation visual QC is independent from UI rollout. This keeps the
// capability easy to extend without coupling it to the visible mode buttons.
export const postGenerationVisualQcModes = [
  "standard",
  "design-system-new"
] as const satisfies readonly ArtworkMode[];

export function usesPostGenerationVisualQc(mode: ArtworkMode): boolean {
  return (
    postGenerationVisualQcEnabled &&
    (postGenerationVisualQcModes as readonly ArtworkMode[]).includes(mode)
  );
}
export const hookIdeaModes = ["standard", "fresh-research"] as const;
export type HookIdeaMode = (typeof hookIdeaModes)[number];
export const defaultHookIdeaMode: HookIdeaMode = "fresh-research";
export const hookGenerationModels = [
  "gpt-5.6-terra",
  "google/gemini-3.6-flash",
  "google/gemini-3.7-flash",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.6-terra",
  "n8n-compass-new"
] as const;
export type BuiltInHookGenerationModel = (typeof hookGenerationModels)[number];
export type HookGenerationModel = string;
export const openRouterHookGenerationModels = [
  "google/gemini-3.6-flash",
  "google/gemini-3.7-flash",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.6-terra"
] as const satisfies readonly HookGenerationModel[];
export type OpenRouterHookGenerationModel =
  (typeof openRouterHookGenerationModels)[number];
export const defaultHookGenerationModels = [
  "google/gemini-3.6-flash"
] as const satisfies readonly HookGenerationModel[];
export const MAX_HOOK_GENERATION_MODELS = 5;

export function isOpenRouterHookGenerationModel(
  model: HookGenerationModel
): boolean {
  return isOpenRouterModelId(model);
}

export function isOpenRouterModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(value)
  );
}

export function isHookGenerationModel(value: unknown): value is HookGenerationModel {
  return (
    value === "gpt-5.6-terra" ||
    value === "n8n-compass-new" ||
    isOpenRouterModelId(value)
  );
}

export function hookGenerationModelLabel(model: HookGenerationModel): string {
  switch (model) {
    case "google/gemini-3.6-flash":
      return "Gemini 3.6 Flash";
    case "google/gemini-3.7-flash":
      return "Gemini 3.7 Flash";
    case "anthropic/claude-sonnet-5":
      return "Claude Sonnet 5";
    case "anthropic/claude-sonnet-4.6":
      return "Claude Sonnet 4.6";
    case "openai/gpt-5.6-terra":
      return "GPT-5.6 Terra";
    case "gpt-5.6-terra":
      return "GPT 5.6 Terra";
    case "n8n-compass-new":
      return "Compass New";
    default:
      return model;
  }
}

export function hookGenerationProviderLabel(
  model: HookGenerationModel
): string {
  if (isOpenRouterHookGenerationModel(model)) return "OpenRouter";
  return model === "n8n-compass-new" ? "n8n" : "OpenAI";
}
export const imagePromptModels = [
  "gpt-5.6-terra",
  "anthropic/claude-sonnet-4.6"
] as const;
export type ImagePromptModel = (typeof imagePromptModels)[number];
export const artworkOutputSizes = [
  "1088x1360",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840"
] as const;
export type ArtworkOutputSize = (typeof artworkOutputSizes)[number];
export const defaultArtworkOutputSize: ArtworkOutputSize = "1088x1360";
export function artworkOutputSizeLabel(size: ArtworkOutputSize): string {
  switch (size) {
    case "1088x1360":
      return "1088x1360 (4:5 portrait)";
    case "1024x1024":
      return "1024x1024 (square)";
    case "1536x1024":
      return "1536x1024 (landscape)";
    case "1024x1536":
      return "1024x1536 (portrait)";
    case "2048x2048":
      return "2048x2048 (2K square)";
    case "2048x1152":
      return "2048x1152 (2K landscape)";
    case "3840x2160":
      return "3840x2160 (4K landscape)";
    case "2160x3840":
      return "2160x3840 (4K portrait)";
  }
}
export const angleExportGroups = ["recommended", "option"] as const;
export type AngleExportGroup = (typeof angleExportGroups)[number];
export const ctaActionTypes = [
  "website",
  "line",
  "phone",
  "form",
  "inbox",
  "store",
  "other"
] as const;
export type CtaActionType = (typeof ctaActionTypes)[number];
export type ReviewDecision = "approved" | "rejected" | null;
export type ClientReviewStatus = "queued" | "sent" | "revision" | "approved";

export interface CreativeBrief {
  service: ServiceType;
  quantity: number;
  text: string;
  attachments: readonly Attachment[];
}

export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  storageKey?: string;
}

export interface ReferenceImageSelection {
  id: string;
  url: string;
  label: string;
  role?: ReferenceImageRole;
  primary?: boolean;
  /** Set when this entry was fanned out from the shared Confirm-hooks-and-create
   * reference picker, so a later sync can replace it without touching references
   * the user attached directly to this hook. */
  fromSharedReference?: boolean;
}

export const MAX_HOOK_REFERENCE_IMAGES = 3;

export function normalizeHookReferenceImages(
  references: readonly ReferenceImageSelection[]
): readonly ReferenceImageSelection[] {
  const deduped: ReferenceImageSelection[] = [];
  for (const reference of references) {
    if (deduped.some((item) => item.url === reference.url)) continue;
    deduped.push(reference);
  }
  return deduped.slice(0, MAX_HOOK_REFERENCE_IMAGES).map((reference, index) => ({
    ...reference,
    role: reference.role ?? "style",
    primary: index === 0
  }));
}

/**
 * Fans the shared (Confirm-hooks-and-create) reference picks into every
 * selected hook's own referenceImages, replacing whatever was fanned in
 * previously without touching references the user attached directly to
 * that hook. Returns the same direction reference when nothing changed,
 * so callers can diff by identity to know what to persist.
 */
export function syncSharedReferenceImagesIntoDirections<
  T extends Pick<CreativeDirection, "id" | "selected" | "referenceImages">
>(
  directions: readonly T[],
  sharedReferences: readonly ReferenceImageSelection[],
  options?: { excludeDirectionIds?: ReadonlySet<string> }
): readonly T[] {
  const tagged = sharedReferences
    .filter((reference) => inferredReferenceImageRole(reference) !== "logo")
    .map((reference) => ({ ...reference, fromSharedReference: true as const }));
  return directions.map((direction) => {
    if (!direction.selected) return direction;
    if (options?.excludeDirectionIds?.has(direction.id)) return direction;
    const existing = direction.referenceImages ?? [];
    const hookOwnReferences = existing.filter(
      (item) => !item.fromSharedReference
    );
    const referenceImages = normalizeHookReferenceImages([
      ...hookOwnReferences,
      ...tagged
    ]);
    if (
      referenceImages.length === existing.length &&
      referenceImages.every(
        (item, index) =>
          item.url === existing[index]?.url &&
          item.role === existing[index]?.role
      )
    ) {
      return direction;
    }
    return { ...direction, referenceImages };
  });
}

export const referenceImageRoles = [
  "product",
  "logo",
  "style",
  "layout",
  "typography",
  "content"
] as const;
export type ReferenceImageRole = (typeof referenceImageRoles)[number];

/** The roles a user can pick for a mood/style reference image, shown as
 * "Use for" in the reference board and per-hook reference picker. Excludes
 * product/logo/content, which are set through their own dedicated flows. */
export const referenceBoardRoleOptions: readonly ReferenceImageRole[] = [
  "style",
  "layout",
  "typography"
];

/** Finds the other reference in the list already holding `nextRole`, if any.
 * A "Use for" picker uses this to swap that reference onto the role being
 * vacated instead of just blocking the pick, so two references can always
 * trade roles in a single click without a role ever going unassigned. */
export function referenceHoldingRole<
  T extends Pick<ReferenceImageSelection, "id" | "label" | "role">
>(
  references: readonly T[],
  excludeId: string,
  nextRole: ReferenceImageRole
): T | undefined {
  return references.find(
    (reference) =>
      reference.id !== excludeId &&
      inferredReferenceImageRole(reference) === nextRole
  );
}

export const referenceImageRoleLabels: Record<ReferenceImageRole, string> = {
  product: "Product",
  logo: "Logo",
  style: "Style",
  layout: "Layout",
  typography: "Fonts",
  content: "Content"
};

export function inferredReferenceImageRole(
  reference: Pick<ReferenceImageSelection, "label" | "role">
): ReferenceImageRole {
  const label = reference.label.trim().toLowerCase();
  if (/^(?:brand\s+)?logo$|^โลโก้(?:แบรนด์)?$/.test(label)) return "logo";
  if (reference.role) return reference.role;
  if (/logo|โลโก้/.test(label)) return "logo";
  if (/product|packshot|สินค้า/.test(label)) return "product";
  if (/guideline|document|copy|text|brief|คู่มือ|ข้อความ/.test(label)) {
    return "content";
  }
  return "style";
}

export const creativeMaterialRoles = [
  "main-object",
  "product",
  "supporting-component",
  "client-context"
] as const;
export type CreativeMaterialRole = (typeof creativeMaterialRoles)[number];

export interface UploadedCreativeMaterial {
  id: string;
  name: string;
  mediaType: string;
  role: CreativeMaterialRole;
  description: string;
  url: string;
  /**
   * Older saved runs do not have this field and are treated as selected.
   * New uploads/imports start unselected so adding an asset never changes a brief.
   */
  selected?: boolean;
  storagePath?: string;
  storageBucket?: string;
}

export const MAX_HOOK_MATERIALS = 4;

export function normalizeHookUploadedMaterials(
  materials: readonly UploadedCreativeMaterial[]
): readonly UploadedCreativeMaterial[] {
  const deduped: UploadedCreativeMaterial[] = [];
  for (const material of materials) {
    if (deduped.some((item) => item.url === material.url)) continue;
    deduped.push(material);
  }
  return deduped.slice(0, MAX_HOOK_MATERIALS);
}

export interface UgcVideoScene {
  title: string;
  duration: string;
  scriptLines: readonly string[];
  visual: string;
  textOverlay: string;
}

export interface UgcVideoBrief {
  product: string;
  duration: string;
  objective: string;
  moodAndTone: string;
  productionStyle: string;
  referenceDirection: string;
  scenes: readonly UgcVideoScene[];
}

export const ugcScriptSpeakers = [
  "staff",
  "customer",
  "narrator",
  "onscreen-text"
] as const;
export type UgcScriptSpeaker = (typeof ugcScriptSpeakers)[number];

export interface UgcScriptLine {
  speaker: UgcScriptSpeaker;
  /** Display name for the speaker, e.g. "พนักงาน" / "ลูกค้า", when the enum alone isn't enough. */
  speakerLabel?: string;
  line: string;
  /** Delivery/acting/camera note for this line. */
  direction?: string;
  /** Optional sound-effect cue, e.g. a pop on a reveal line. */
  sfx?: string;
}

export const ugcScriptBeatRoles = [
  "hook",
  "product-intro",
  "eligibility",
  "misconception",
  "benefit-stack",
  "cta"
] as const;
export type UgcScriptBeatRole = (typeof ugcScriptBeatRoles)[number];

export interface UgcScriptBeat {
  id: string;
  role: UgcScriptBeatRole;
  title: string;
  /** Free-text time range, same convention as UgcVideoScene.duration. */
  timecode: string;
  lines: readonly UgcScriptLine[];
  cameraNotes?: string;
  editingNotes?: string;
  /** Set when this beat contains a claim that needs legal/compliance review before production. */
  legalFlag?: string;
}

/**
 * Rich, flexible-length two-speaker production script for a UGC video direction.
 * Additive and separate from UgcVideoBrief, which stays the source of truth for the
 * fixed 4-scene deck slide — this document has no scene-count limit and is exported
 * as its own creator brief, not rendered onto the slide.
 */
export interface UgcScriptDocument {
  directionId: string;
  format: {
    duration: string;
    aspectRatio: string;
    style: string;
  };
  castDirection: string;
  beats: readonly UgcScriptBeat[];
  shotList: readonly string[];
  editingNotes: readonly string[];
  legalFooter?: string;
}

export interface CreativeDirection {
  id: string;
  /** Model that generated this idea, used to compare concurrent Hook runs. */
  generationModel?: HookGenerationModel;
  /** Deliverable this direction was written for. Optional for saved legacy runs. */
  service?: ServiceType;
  /** Marks a hook entered by a user instead of generated by the Hook agent. */
  manual?: boolean;
  /** Short strategic category used by manually entered hooks. */
  pillar?: string;
  /** Review objective used by manually entered hooks. */
  objective?: string;
  hook: string;
  /** Concise supporting copy shown below the hook. Optional for saved legacy runs. */
  subheadline?: string;
  concept: string;
  /** Exact phrase inside the subheadline that should render bold. */
  subheadlineHighlight?: string;
  /** Review section used only when exporting the Angles PDF. */
  exportGroup?: AngleExportGroup | null;
  why: string;
  visual: string;
  cta: string;
  /** Short, verified facts that may support the caption or one artwork text block. */
  supportingPoints?: readonly string[];
  /** Format-native story beats. Album/UGC/video directions use exactly three. */
  formatBeats?: readonly string[];
  /** Album layout selected for this idea when the run uses automatic selection. */
  albumFormat?: AlbumFormat;
  /** User-supplied visual references scoped to this Hook only. */
  referenceImages?: readonly ReferenceImageSelection[];
  /** User-supplied creative materials (product shots, etc.) scoped to this Hook only. */
  uploadedMaterials?: readonly UploadedCreativeMaterial[];
  /** Production-ready detail generated only for UGC video directions. */
  ugcBrief?: UgcVideoBrief;
  /** Rich, flexible-length two-speaker script generated only for UGC video directions. Additive — ugcBrief stays the source of truth for the deck slide. */
  ugcScript?: UgcScriptDocument;
  /** Intended conversion route for the CTA. Optional for saved legacy runs. */
  ctaActionType?: CtaActionType;
  /** Verified destination copied from brand context. Never generated from inference. */
  ctaDestination?: string;
  /** Reusable contact/footer line copied exactly from verified brand inputs or past posts. */
  contactLine?: string;
  caption: string;
  score?: number;
  selected: boolean;
}

export interface ApprovalGate {
  graphicDesign: ReviewDecision;
  clientService: ReviewDecision;
  projectManager: ReviewDecision;
}

export type ApprovalRole = keyof ApprovalGate;

export const emptyApprovalGate: ApprovalGate = {
  graphicDesign: null,
  clientService: null,
  projectManager: null
};

export type ApprovalComments = Record<ApprovalRole, string>;

export const emptyApprovalComments: ApprovalComments = {
  graphicDesign: "",
  clientService: "",
  projectManager: ""
};

export interface CreativeAssetVersion {
  version: number;
  assetUrl: string;
  assetStoragePath?: string;
  assetBucket?: string;
  albumMasterAssetUrl?: string;
  albumMasterAssetStoragePath?: string;
}

export interface CreativeOutput {
  id: string;
  directionId: string;
  format: string;
  status: "draft" | "needs-revision" | "ready" | "fixed";
  clientStatus: ClientReviewStatus;
  assetUrl?: string;
  assetStoragePath?: string;
  assetBucket?: string;
  albumMasterAssetUrl?: string;
  albumMasterAssetStoragePath?: string;
  assetHistory?: readonly CreativeAssetVersion[];
  provider?: string;
  model?: string;
  revisionCount: number;
  approval: ApprovalGate;
  approvalComments: ApprovalComments;
  qaNote?: string;
  qaReport?: CreativeQualityReport;
  savedToReferences?: boolean;
}

export interface CreativeRun {
  id: string;
  brandId: string | null;
  stage: CreativeStage;
  artworkMode: ArtworkMode;
  imagePromptModel: ImagePromptModel;
  albumFormat: AlbumFormatPreference;
  outputSize: ArtworkOutputSize;
  brief: CreativeBrief;
  directions: readonly CreativeDirection[];
  outputs: readonly CreativeOutput[];
  approval: ApprovalGate;
  createdAt: string;
  updatedAt: string;
}
