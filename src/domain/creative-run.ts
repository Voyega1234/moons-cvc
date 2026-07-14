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
export const artworkModes = ["standard", "design-system"] as const;
export type ArtworkMode = (typeof artworkModes)[number];
export const imagePromptModels = [
  "gpt-5.6-terra",
  "anthropic/claude-sonnet-4.6"
] as const;
export type ImagePromptModel = (typeof imagePromptModels)[number];
export const angleExportGroups = ["recommended", "option"] as const;
export type AngleExportGroup = (typeof angleExportGroups)[number];
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
}

export interface CreativeDirection {
  id: string;
  /** Deliverable this direction was written for. Optional for saved legacy runs. */
  service?: ServiceType;
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
  caption: string;
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

export interface CreativeOutput {
  id: string;
  directionId: string;
  format: string;
  status: "draft" | "needs-revision" | "ready" | "fixed";
  clientStatus: ClientReviewStatus;
  assetUrl?: string;
  assetStoragePath?: string;
  assetBucket?: string;
  provider?: string;
  model?: string;
  revisionCount: number;
  approval: ApprovalGate;
  approvalComments: ApprovalComments;
  qaNote?: string;
}

export interface CreativeRun {
  id: string;
  brandId: string | null;
  stage: CreativeStage;
  artworkMode: ArtworkMode;
  imagePromptModel: ImagePromptModel;
  brief: CreativeBrief;
  directions: readonly CreativeDirection[];
  outputs: readonly CreativeOutput[];
  approval: ApprovalGate;
  createdAt: string;
  updatedAt: string;
}
