import type { CreativeDirection } from "../../domain/creative-run";

export function buildDirectionFixtures(brandName: string): readonly CreativeDirection[] {
  return Array.from({ length: 6 }, (_, index) => ({
    id: `direction-${index + 1}`,
    hook: `${brandName} hook ${index + 1}`,
    subheadline: `Subheadline ${index + 1}`,
    concept: `Concept ${index + 1}`,
    why: `Why ${index + 1}`,
    visual: `Visual ${index + 1}`,
    cta: `CTA ${index + 1}`,
    caption: `${brandName} hook ${index + 1} caption.`,
    selected: false
  }));
}
