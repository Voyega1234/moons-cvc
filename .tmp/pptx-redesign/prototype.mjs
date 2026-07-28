import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const root = "/Users/waveconvertcake/Desktop/CVC Projects/Moons Project";
const outputDir = `${root}/artifacts/creative-slides-redesign`;
const artworkPath =
  `${root}/logs/artwork-generation/2026-07-28T03-36-26-581Z-run-6a3c7394-0e89-43a2-b3b7-4b1b71afa375-chol-static-02-output.png`;

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

function addText(slide, text, position, style = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontFamily: "Sarabun",
    color: "#191B27",
    verticalAlignment: "top",
    ...style,
  };
  return shape;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const deck = Presentation.create({
    slideSize: { width: 1280, height: 720 },
  });
  const slide = deck.slides.add();
  slide.background.fill = "#F4F4F0";

  slide.shapes.add({
    geometry: "roundRect",
    position: { left: 32, top: 32, width: 586, height: 656 },
    fill: "#FFFFFF",
    line: { style: "solid", fill: "#E3E4DD", width: 1 },
    borderRadius: "rounded-2xl",
  });
  slide.images.add({
    blob: await fs.readFile(artworkPath),
    contentType: "image/png",
    alt: "CHÔL Aromatique static creative artwork",
    fit: "contain",
    position: { left: 52, top: 52, width: 546, height: 616 },
  });

  addText(
    slide,
    "CHÔL AROMATIQUE",
    { left: 660, top: 48, width: 330, height: 26 },
    { fontSize: 14, bold: true, color: "#625BFF", letterSpacing: 1.4 },
  );
  addText(
    slide,
    "STATIC",
    { left: 1110, top: 48, width: 114, height: 26 },
    { fontSize: 13, bold: true, color: "#465100", textAlign: "right" },
  );

  addText(
    slide,
    "คนที่เลือกของเข้าบ้าน\nเหมือนเลือกความรู้สึกให้ทุกวัน",
    { left: 660, top: 100, width: 560, height: 112 },
    { fontSize: 34, bold: true, lineSpacing: 0.93 },
  );
  addText(
    slide,
    "กลิ่นที่อยู่ในบ้านนานกว่าความสวย และเปลี่ยนอารมณ์ของทุกวันได้",
    { left: 660, top: 224, width: 548, height: 48 },
    { fontSize: 18, color: "#707487", lineSpacing: 1.15 },
  );

  slide.shapes.add({
    geometry: "rect",
    position: { left: 660, top: 302, width: 46, height: 4 },
    fill: "#625BFF",
    line: { style: "solid", fill: "none", width: 0 },
  });
  addText(
    slide,
    "CAPTION",
    { left: 660, top: 324, width: 180, height: 24 },
    { fontSize: 13, bold: true, color: "#707487", letterSpacing: 1.3 },
  );
  addText(
    slide,
    "บ้านที่น่าอยู่ ไม่ได้มีแค่เฟอร์นิเจอร์ที่สวย แต่ยังมี “กลิ่น” ที่ทำให้ทุกครั้งที่เปิดประตูรู้สึกว่าได้กลับมาพักจริง ๆ\n\nUrban Diffuser จับคู่กับ Aroma Oil Urban ให้บรรยากาศอบอุ่น สุขุม และเป็นตัวเองมากขึ้น พร้อมโปรชุด Urban + Aroma Oil เหลือ ฿1,185",
    { left: 660, top: 358, width: 552, height: 190 },
    { fontSize: 18, color: "#282B37", lineSpacing: 1.25 },
  );

  addText(
    slide,
    "CALL TO ACTION",
    { left: 660, top: 574, width: 170, height: 24 },
    { fontSize: 13, bold: true, color: "#707487", letterSpacing: 1.2 },
  );
  addText(
    slide,
    "เลือกชุด Urban + Aroma Oil →",
    { left: 660, top: 605, width: 430, height: 34 },
    { fontSize: 20, bold: true, color: "#191B27" },
  );
  addText(
    slide,
    "Concept · Everyday home ritual",
    { left: 660, top: 660, width: 430, height: 20 },
    { fontSize: 12, color: "#8A8E9E" },
  );
  addText(
    slide,
    "01 / 01",
    { left: 1144, top: 660, width: 78, height: 20 },
    { fontSize: 12, color: "#8A8E9E", textAlign: "right" },
  );

  slide.speakerNotes.textFrame.setText(
    "[Sources]\n- Local creative artwork: logs/artwork-generation/2026-07-28T03-36-26-581Z-run-6a3c7394-0e89-43a2-b3b7-4b1b71afa375-chol-static-02-output.png\n- Caption text: layout prototype copy derived from the visible creative artwork; not an external factual claim.",
  );

  await writeBlob(
    `${outputDir}/slide-01.png`,
    await deck.export({ slide, format: "png", scale: 1 }),
  );
  await fs.writeFile(
    `${outputDir}/slide-01.layout.json`,
    await (await slide.export({ format: "layout" })).text(),
  );
  await writeBlob(
    `${outputDir}/montage.webp`,
    await deck.export({ format: "webp", montage: true, scale: 1 }),
  );
  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(`${outputDir}/creative-slides-redesign-prototype.pptx`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
