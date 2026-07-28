import { readFile } from "node:fs/promises";
import {
  buildCreateStageSlidesPptx,
  type ClientSlideImageResolver
} from "../../src/features/workflow/export-client-slides-pptx";

const root = "/Users/waveconvertcake/Desktop/CVC Projects/Moons Project";
const artworkPath =
  `${root}/logs/artwork-generation/2026-07-28T03-36-26-581Z-run-6a3c7394-0e89-43a2-b3b7-4b1b71afa375-chol-static-02-output.png`;
const imageUrl = "https://example.com/chol-static.png";

const resolver: ClientSlideImageResolver = async () =>
  `data:image/png;base64,${(await readFile(artworkPath)).toString("base64")}`;

const sharedDirection = {
  service: "static" as const,
  angle: "Everyday ritual",
  why: "Make the emotional benefit of scent immediately understandable.",
  visual: "Warm premium home atmosphere with strong product visibility.",
  accent: "#625BFF",
  score: 92,
  selected: true,
  deleted: false,
  caption:
    "Make Time to Let Your Space Feel Good. 🤍\n\n·\nบางรายละเอียดอาจมองไม่เห็น แต่ทำให้พื้นที่เดิมรู้สึกต่างออกไปได้\n\n·\n🌿 Urban + Aroma Oil\nเติมกลิ่นหอม สร้างมู้ด และรีเฟรชพื้นที่ ให้ทุกมุมที่คุณใช้ชีวิตน่าอยู่ขึ้น\n\n·\nพิเศษ ชุด Urban + Aroma Oil\nจาก ฿1,580 เหลือ ฿1,185 (25%)\n\n·\nเพราะกลิ่นหอมที่ใช่ ไม่ได้เปลี่ยนแค่บรรยากาศ\nแต่เปลี่ยนเวลาที่เราใช้ ให้มีความหมายมากขึ้น\n\n·\n#CHOLAromatique #MakeTimeMakeItMatter #HomeAroma #EssentialOil #Aromatherapy",
  cta: "เลือกชุด Urban + Aroma Oil"
};

const state = {
  brand: { name: "CHÔL Aromatique" },
  outputSize: "1080x1350" as const,
  referenceImages: [
    {
      id: "ugc-reference",
      url: imageUrl,
      label: "Warm home UGC reference",
      role: "style" as const,
      primary: true
    }
  ],
  albumFormat: "three-horizontal" as const,
  directions: [
    {
      ...sharedDirection,
      id: "direction-static",
      hook: "คนที่เลือกของเข้าบ้าน เหมือนเลือกความรู้สึกให้ทุกวัน",
      concept: "Everyday home ritual"
    },
    {
      ...sharedDirection,
      id: "direction-album",
      service: "album" as const,
      hook: "สามรายละเอียดเล็ก ๆ ที่เปลี่ยนบรรยากาศของบ้าน",
      concept: "A three-frame scent story",
      albumFormat: "three-horizontal" as const
    },
    {
      ...sharedDirection,
      id: "direction-ugc",
      service: "ugc-video" as const,
      hook: "กลิ่นเดียวที่ทำให้คำว่า ‘กลับบ้าน’ รู้สึกชัดขึ้น",
      concept: "Creator-led home ritual",
      caption:
        "ลองเริ่มจากช่วงเวลาสั้น ๆ หลังกลับถึงบ้าน วางโทรศัพท์ เปิด diffuser แล้วปล่อยให้กลิ่น Urban เปลี่ยนมุมเดิมให้กลายเป็นเวลาพักของเรา",
      formatBeats: [
        "เปิดประตูเข้าบ้านพร้อมเล่าความเหนื่อยของวัน",
        "เติม Aroma Oil และถ่าย close-up หมอกหอม",
        "นั่งพักแล้วชวนเลือกกลิ่นที่อยากกลับมาเจอ"
      ],
      ugcBrief: {
        product: "Urban Diffuser + Aroma Oil Urban",
        duration: "15–30 วินาที",
        objective: "ทำให้ผู้ชมเห็นภาพ ritual หลังกลับถึงบ้าน",
        moodAndTone: "อบอุ่น เป็นธรรมชาติ และผ่อนคลาย",
        productionStyle: "Creator POV สลับ close-up ผลิตภัณฑ์",
        referenceDirection: "แสงเย็นในบ้าน โทนอุ่น และจังหวะตัดต่อช้า",
        openingScript: "เปิดประตูเข้าบ้านพร้อมพูดว่าวันนี้เหนื่อยแค่ไหน",
        showcaseScript: "หยด Aroma Oil แล้วถ่ายหมอกหอมแบบ close-up",
        closingScript: "นั่งพักและชวนเลือกกลิ่นที่อยากกลับมาเจอทุกวัน"
      }
    }
  ],
  outputs: [
    {
      id: "direction-static-static-v1",
      directionId: "direction-static",
      format: "Static",
      assetUrl: imageUrl,
      version: 1,
      approval: {}
    },
    ...[1, 2, 3].map((panel) => ({
      id: `direction-album-album-${panel}-v1`,
      directionId: "direction-album",
      format: "Album post",
      assetUrl: imageUrl,
      version: 1,
      approval: {}
    })),
    {
      id: "direction-ugc-ugc-v1",
      directionId: "direction-ugc",
      format: "9:16 UGC",
      version: 1,
      approval: {}
    }
  ]
};

const pptx = await buildCreateStageSlidesPptx(state as never, resolver);
await pptx.writeFile({
  fileName: `${root}/artifacts/creative-slides-redesign/system-export-sample.pptx`,
  compression: true
});
