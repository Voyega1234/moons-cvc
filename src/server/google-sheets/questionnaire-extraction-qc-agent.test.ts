import { describe, expect, it, vi } from "vitest";
import { reviewQuestionnaireExtractionWithLuna } from "./questionnaire-extraction-qc-agent";

describe("reviewQuestionnaireExtractionWithLuna", () => {
  it("uses Luna to remap answers while preserving verbatim Sheet evidence", async () => {
    const rows = [
      ["Brand name TH", "โรงบาลสัตว์ทองหล่อ"],
      ["Brand name EN", "Thonglor Pet Hospital"],
      ["Brand name pronunciation", ""],
      [
        "Brand description",
        "โรงพยาบาลสัตว์ทองหล่อ มีความเข้าใจสัตว์เลี้ยง และ เจ้าของสัตว์เลี้ยง"
      ],
      ["Media Channels", "https://thonglorpet.com/"],
      ["Facebook", "https://www.facebook.com/ThonglorPet"],
      ["Products main competitors", "List known competitors"],
      ["Competitor 1", "Arak"],
      ["Page URL", "https://www.facebook.com/ArakAnimalHospital/"],
      ["Products target customer", "Share key traits like age and lifestyle"]
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        text: { format: { schema: unknown } };
      };
      expect(body.model).toBe("gpt-5.6-luna");
      expect(body.text.format.schema).toBeTruthy();
      return jsonResponse({
        output_text: JSON.stringify({
          fields: [
            {
              key: "brand_name_th",
              sourceQuotes: ["โรงบาลสัตว์ทองหล่อ"]
            },
            {
              key: "brand_name_en",
              sourceQuotes: ["Thonglor Pet Hospital"]
            },
            {
              key: "brand_description",
              sourceQuotes: [
                "โรงพยาบาลสัตว์ทองหล่อ มีความเข้าใจสัตว์เลี้ยง และ เจ้าของสัตว์เลี้ยง"
              ]
            },
            {
              key: "brand_media_channel_website",
              sourceQuotes: ["https://thonglorpet.com/"]
            },
            {
              key: "brand_media_channel_facebook",
              sourceQuotes: ["https://www.facebook.com/ThonglorPet"]
            },
            {
              key: "products_main_competitors",
              sourceQuotes: [
                "Arak",
                "https://www.facebook.com/ArakAnimalHospital/"
              ]
            }
          ]
        })
      });
    });

    await expect(
      reviewQuestionnaireExtractionWithLuna({
        rows,
        extractedFields: [
          {
            key: "brand_description",
            label: "Brand description",
            value:
              "โรงพยาบาลสัตว์ทองหล่อ มีความเข้าใจสัตว์เลี้ยง และ เจ้าของสัตว์เลี้ยง\n\nMedia Channels\n\nhttps://thonglorpet.com/"
          },
          {
            key: "products_target_customer",
            label: "Products target customer",
            value: "Share key traits like age and lifestyle"
          }
        ],
        apiKey: "openai-key",
        fetchImpl
      })
    ).resolves.toEqual([
      {
        key: "brand_name_th",
        label: "Brand name TH",
        value: "โรงบาลสัตว์ทองหล่อ"
      },
      {
        key: "brand_name_en",
        label: "Brand name EN",
        value: "Thonglor Pet Hospital"
      },
      {
        key: "brand_description",
        label: "Brand description",
        value:
          "โรงพยาบาลสัตว์ทองหล่อ มีความเข้าใจสัตว์เลี้ยง และ เจ้าของสัตว์เลี้ยง"
      },
      {
        key: "brand_media_channel_website",
        label: "Brand media channel website",
        value: "https://thonglorpet.com/"
      },
      {
        key: "brand_media_channel_facebook",
        label: "Brand media channel facebook",
        value: "https://www.facebook.com/ThonglorPet"
      },
      {
        key: "products_main_competitors",
        label: "Products main competitors",
        value:
          "Arak\n\nhttps://www.facebook.com/ArakAnimalHospital/"
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("discards an ungrounded quote without rejecting other grounded evidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output_text: JSON.stringify({
          fields: [
            {
              key: "brand_name_en",
              sourceQuotes: ["Real Brand", "Invented Brand"]
            },
            {
              key: "brand_description",
              sourceQuotes: ["A real description"]
            }
          ]
        })
      })
    );

    await expect(
      reviewQuestionnaireExtractionWithLuna({
        rows: [
          ["Brand name EN", "Real Brand"],
          ["Brand description", "A real description"]
        ],
        extractedFields: [],
        apiKey: "openai-key",
        fetchImpl
      })
    ).resolves.toEqual([
      {
        key: "brand_name_en",
        label: "Brand name EN",
        value: "Real Brand"
      },
      {
        key: "brand_description",
        label: "Brand description",
        value: "A real description"
      }
    ]);
  });

  it("rejects a Luna result with no grounded Sheet evidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output_text: JSON.stringify({
          fields: [
            {
              key: "brand_name_en",
              sourceQuotes: ["Invented Brand"]
            }
          ]
        })
      })
    );

    await expect(
      reviewQuestionnaireExtractionWithLuna({
        rows: [["Brand name EN", "Real Brand"]],
        extractedFields: [],
        apiKey: "openai-key",
        fetchImpl
      })
    ).rejects.toThrow("found no grounded answered fields");
  });

  it("surfaces provider failures instead of accepting unchecked extraction", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        { error: { message: "model unavailable" } },
        { status: 503 }
      )
    );

    await expect(
      reviewQuestionnaireExtractionWithLuna({
        rows: [["Brand name EN", "Real Brand"]],
        extractedFields: [],
        apiKey: "openai-key",
        fetchImpl
      })
    ).rejects.toThrow(
      "GPT Luna questionnaire QC failed: 503 — model unavailable"
    );
  });
});

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json" }
  });
}
