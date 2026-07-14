import { readFile } from "node:fs/promises";

const referencePath = new URL(
  "../neo-creative-compass.html",
  import.meta.url
);
const html = await readFile(referencePath, "utf8");

const requiredMarkers = [
  'id="studioView"',
  'id="stageStart"',
  'id="stageBrief"',
  'id="stageAngles"',
  'id="stageBuild"',
  'id="stageCritique"',
  'id="stageClient"',
  'id="stageLearn"',
  'id="workboardView"',
  "function init(){",
  "updateUI();"
];

const missing = requiredMarkers.filter((marker) => !html.includes(marker));

if (missing.length > 0) {
  console.error("Prototype verification failed. Missing:");
  missing.forEach((marker) => console.error(`- ${marker}`));
  process.exitCode = 1;
} else {
  console.log("Prototype reference verified.");
}
