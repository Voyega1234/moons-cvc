import type {
  CreativeStage,
  ServiceType
} from "../../domain/creative-run";

export const stages: readonly {
  id: CreativeStage;
  name: string;
  hero: string;
  sub: string;
}[] = [
  {
    id: "start",
    name: "Start",
    hero: "Start.",
    sub: "Choose the brand memory before creating."
  },
  {
    id: "brief",
    name: "Brief",
    hero: "Brief.",
    sub: "Give Moons the request: service, quantity, and brief."
  },
  {
    id: "directions",
    name: "Hook",
    hero: "Hook.",
    sub: "Choose the creative direction before production."
  },
  {
    id: "studio",
    name: "Create",
    hero: "Create.",
    sub: "Generate artwork and captions, then quality-check."
  },
  {
    id: "approval",
    name: "Internal QC",
    hero: "Internal QC.",
    sub: "Human approval gate before the client sees the work."
  },
  {
    id: "client",
    name: "Client review",
    hero: "Client review.",
    sub: "Send creatives, capture feedback, revise, and approve."
  },
  {
    id: "summary",
    name: "Delivered",
    hero: "Delivered.",
    sub: "Final approved set, saved to past work."
  }
];

export const serviceLabels: Record<ServiceType, string> = {
  "single-static": "Single static",
  "album-post": "Album post",
  "motion-static": "Motion static",
  resize: "Resize",
  "ugc-video": "UGC video"
};
