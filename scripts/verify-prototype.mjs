import { readFile } from "node:fs/promises";

const referencePath = new URL(
  "../moons-prototype-22-jun-26.html",
  import.meta.url
);
const html = await readFile(referencePath, "utf8");

const requiredMarkers = [
  'data-stage="start"',
  'data-stage="brief"',
  'data-stage="directions"',
  'data-stage="studio"',
  'data-stage="approval"',
  'data-stage="client"',
  'data-stage="summary"',
  'id="overviewView"',
  "bootstrapRuns();",
  "render();"
];

const missing = requiredMarkers.filter((marker) => !html.includes(marker));

if (missing.length > 0) {
  console.error("Prototype verification failed. Missing:");
  missing.forEach((marker) => console.error(`- ${marker}`));
  process.exitCode = 1;
} else {
  console.log("Prototype reference verified.");
}
