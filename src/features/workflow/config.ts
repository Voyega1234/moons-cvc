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
    name: "Signal",
    hero: "Find the idea worth scaling.",
    sub: "Turn brand signals into sharper hooks, stronger creative, and reusable performance learning."
  },
  {
    id: "brief",
    name: "Brief",
    hero: "Brief.",
    sub: "Give Neo the content mix, quantities, and brief."
  },
  {
    id: "directions",
    name: "Angles",
    hero: "Angles.",
    sub: "Choose the creative direction before production."
  },
  {
    id: "studio",
    name: "Build",
    hero: "Build.",
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
    name: "Client",
    hero: "Client.",
    sub: "Send creatives, capture feedback, revise, and approve."
  },
  {
    id: "summary",
    name: "Learn",
    hero: "Learn.",
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
