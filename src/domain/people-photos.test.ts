import { expect, it } from "vitest";
import { buildPeoplePhotoInstruction, PEOPLE_PHOTO_PREFIX, peoplePhotoPath, peoplePhotoTitle, peoplePhotoDetails, peoplePhotoSourceLabel, selectPeoplePhotoNames, readPeoplePhotoAnalysis } from "./people-photos";

it("stores AI labels once, uses them for search, and prioritizes team age metadata", () => {
  const labels = { description: "Person seated at office desk", tags: ["office", "desk", "seated"], apparentAgeBand: "35-44" as const };
  const path = peoplePhotoPath("DSC0001", "image/jpeg", { ageBand: "unknown", gender: "unspecified" }, labels);
  expect(peoplePhotoDetails(path).analysis).toEqual(labels);
  expect(path.length).toBeLessThan(1000);
  expect(peoplePhotoSourceLabel(path)).toContain("AI estimate, not actual age");
  expect(peoplePhotoSourceLabel(path)).toContain("Gender (team-provided): Not specified");
  expect(selectPeoplePhotoNames([peoplePhotoPath("Other", "image/png"), path], "office desk", 1)).toEqual([path]);
  const confirmed = peoplePhotoPath("DSC0001", "image/jpeg", { ageBand: "25-34", gender: "woman" }, labels);
  expect(peoplePhotoSourceLabel(confirmed)).toContain("Age band (team-provided): 25–34");
  expect(peoplePhotoSourceLabel(confirmed)).not.toContain("AI estimate, not actual age");
  expect(() => readPeoplePhotoAnalysis({ ...labels, tags: Array(7).fill("tag") })).toThrow();
  const thai = peoplePhotoPath("DSC0002", "image/jpeg", undefined, { ...labels, tags: ["นั่งโต๊ะ", "เสื้อเชิ้ต"] });
  expect(selectPeoplePhotoNames([path, thai], "อยากได้คนนั่งโต๊ะทำงาน", 1)).toEqual([thai]);
});

it("retains team-supplied casting metadata and leaves old photos unknown", () => {
  const path = peoplePhotoPath("ผู้หญิง นั่งโต๊ะ", "image/jpeg", { ageBand: "35-44", gender: "woman" });
  expect(peoplePhotoDetails(path)).toEqual({ title: "ผู้หญิง นั่งโต๊ะ", ageBand: "35-44", gender: "woman" });
  expect(peoplePhotoDetails(peoplePhotoPath("DSC0001", "image/jpeg"))).toEqual({ title: "DSC0001", ageBand: "unknown", gender: "unspecified" });
  expect(peoplePhotoSourceLabel(path)).toContain("Gender (team-provided): Woman");
  expect(peoplePhotoSourceLabel(path)).toContain("35–44");
  expect(buildPeoplePhotoInstruction([peoplePhotoSourceLabel(path)])).toContain("Do not infer gender identity or actual age");
});

it("shortlists by supplied age/gender without confusing man and woman", () => {
  const man = peoplePhotoPath("Portrait", "image/jpeg", { ageBand: "35-44", gender: "man" });
  const olderWoman = peoplePhotoPath("Portrait", "image/jpeg", { ageBand: "60+", gender: "woman" });
  const woman = peoplePhotoPath("Portrait", "image/jpeg", { ageBand: "35-44", gender: "woman" });
  expect(selectPeoplePhotoNames([man, olderWoman, woman], "woman aged 35-44", 1)).toEqual([woman]);
  expect(selectPeoplePhotoNames([woman, man], "man at work", 1)).toEqual([man]);
});

it("round-trips Thai photo descriptions with safe, unique storage keys", () => {
  const title = "คนทำงาน หญิง นั่งโต๊ะ — photo.png";
  const path = peoplePhotoPath(title, "image/png");
  expect(path).toMatch(/^shared-people-photos\/[\w-]+\.png$/);
  expect(peoplePhotoTitle(path)).toBe(title);
  expect(peoplePhotoPath(title, "image/png")).not.toBe(path);
});

it("keeps people optional and preserves original image numbering", () => {
  expect(buildPeoplePhotoInstruction(["Uploaded main object: serum"])).toBe("");
  const instruction = buildPeoplePhotoInstruction(["Logo", `${PEOPLE_PHOTO_PREFIX}woman at desk`]);
  expect(instruction).toContain("Image 2:");
  expect(instruction).toContain("never add people just because");
  expect(instruction).toContain("empty array when none fits");
  expect(instruction).toContain("not mandatory subjects, products");
  const generation = buildPeoplePhotoInstruction([`${PEOPLE_PHOTO_PREFIX}portrait`], true);
  expect(generation).toContain("instead of replacing them with generic AI faces");
  expect(generation).not.toContain("peoplePhotoImages");
});

it("shortlists by descriptions, caps candidates, and keeps recent order for ties", () => {
  const ordinary = Array.from({ length: 8 }, (_, index) => peoplePhotoPath(`portrait-${index}`, "image/jpeg"));
  const matching = peoplePhotoPath("woman working at office desk", "image/jpeg");
  const selected = selectPeoplePhotoNames([...ordinary, matching], "office desk");
  expect(selected).toHaveLength(6);
  expect(selected[0]).toBe(matching);
  expect(selected.slice(1)).toEqual(ordinary.slice(0, 5));
});

it("matches child-focused briefs to child sources before unrelated recently uploaded adults", () => {
  const adults = Array.from({ length: 8 }, () => peoplePhotoPath("Studio portrait", "image/jpeg", { ageBand: "25-34", gender: "unspecified" }));
  const child = peoplePhotoPath("Studio portrait", "image/jpeg", undefined, { description: "Child seated in studio", tags: ["สตูดิโอ"], apparentAgeBand: "under18" });
  for (const brief of ["วิตามินสำหรับเด็ก เจ้าตัวเล็ก", "Children refusing vegetables", "baby nutrition"])
    expect(selectPeoplePhotoNames([...adults, child], brief, 1)).toEqual([child]);
  expect(selectPeoplePhotoNames([child, ...adults], "parent aged 25-34 and child", 1)).toEqual([adults[0]]);
});

it("lets casting adapt the pose while requiring a source for any planned person", () => {
  const instruction = buildPeoplePhotoInstruction([`${PEOPLE_PHOTO_PREFIX}Child seated in studio`]);
  expect(instruction).toContain("not the original pose, wardrobe, setting or props");
  expect(instruction).toContain("any person, return at least one");
  expect(instruction).toContain("explicitly human-free");
});

it("anchors facial identity while art-directing pose, wardrobe and light as one shoot", () => {
  const labels = [`${PEOPLE_PHOTO_PREFIX}Person in an office`];
  const planning = buildPeoplePhotoInstruction(labels);
  expect(planning).toContain("face as the identity anchor only");
  expect(planning).toContain("original outfit, body pose and light direction must not constrain");
  const generation = buildPeoplePhotoInstruction(labels, true);
  expect(generation).toContain("not a pixel-preserving cutout");
  expect(generation).toContain("wardrobe, hair styling, expression, makeup");
  expect(generation).toContain("shadows and contact shadows");
  expect(generation).toContain("never a pasted-in portrait");
});
