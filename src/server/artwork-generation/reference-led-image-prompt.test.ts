import { describe, expect, it } from "vitest";
import { buildReferenceLedImagePrompt } from "./reference-led-image-prompt";

describe("buildReferenceLedImagePrompt", () => {
  it("uses the reference as the visual blueprint without promoting supporting points to visible copy", async () => {
    const prompt = await buildReferenceLedImagePrompt(
      {
        brand: {
          name: "De Hygienique",
          category: "Mattress cleaning",
          personality: [],
          colors: ["green", "white"]
        },
        service: "single-static",
        brief: "Explain the hidden dust problem.",
        hook: {
          hook: "เปลี่ยนผ้าปู ไม่ได้เปลี่ยนข้างในฟูก",
          subheadline: "สิ่งที่มองไม่เห็น อาจยังอยู่ข้างใน",
          concept: "Reveal what remains below clean sheets.",
          why: "Create urgency around deep mattress cleaning.",
          visual: "This field must not be used.",
          cta: "ส่งรูปฟูกให้เราดูแล",
          supportingPoints: [
            "ระบบสั่นสำหรับที่นอน",
            "ดูดออกด้วยระบบสูญญากาศ",
            "ระบบแสงยูวี"
          ],
          caption: "Caption must not be visible copy."
        },
        textInputs: [],
        referenceImageLabels: ["Official logo · De Hygienique"],
        referenceImages: [],
        canvasRatio: "1:1",
        brandLibrary: {
          brand: [
            {
              title: "Brand CI Guideline",
              description: "Use De Hygienique green and the official Thai font. Keep the mood clinical, bright, and reassuring."
            }
          ],
          products: [],
          docs: [],
          refs: []
        }
      },
      {
        artworkConcept: "Reveal the hidden layer beneath a clean surface.",
        keyVisualGrammar: "A cutaway makes the invisible problem tangible.",
        compositionGrammar: "Asymmetric editorial grid.",
        graphicDeviceLogic: "A functional footer contains secondary proof.",
        hierarchyAndDensity: "One dominant headline and one hero.",
        secondaryAndFooterGrammar: "A grounded green footer zone.",
        conceptTranslation: "Show a new cutaway revealing the mattress layer.",
        preserve: ["editorial hierarchy", "green footer device"],
        replace: ["source people", "source cleaning scene"]
      },
      async () =>
        "DESIGN-GRAMMAR-LED GENERATION\nCreate a new hero from the grammar."
    );

    expect(prompt).toContain("DESIGN-GRAMMAR-LED GENERATION");
    expect(prompt).toContain("Show a new cutaway revealing the mattress layer");
    expect(prompt).toContain("MANDATORY — overrides every conflicting reference trait");
    expect(prompt).toContain("official Thai font");
    expect(prompt).toContain('"personality"');
    expect(prompt).toContain('"optionalSupportingLine"');
    expect(prompt).toContain("เปลี่ยนผ้าปู ไม่ได้เปลี่ยนข้างในฟูก");
    expect(prompt).not.toContain("ระบบสั่นสำหรับที่นอน");
    expect(prompt).not.toContain("Caption must not be visible copy");
    expect(prompt).not.toContain("This field must not be used");
    expect(prompt).not.toContain("AUTHORITATIVE PREFLIGHTED CAMPAIGN INPUT");
  });
});
