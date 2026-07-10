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
  hook: string;
  concept: string;
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
  brief: CreativeBrief;
  directions: readonly CreativeDirection[];
  outputs: readonly CreativeOutput[];
  approval: ApprovalGate;
  createdAt: string;
  updatedAt: string;
}
