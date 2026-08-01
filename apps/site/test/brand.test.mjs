import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { brandName, brandTagline, brandTaglineZh } from "../src/lib/brand.ts";

test("public brand names and taglines stay canonical", () => {
  assert.equal(brandName, "Carrick AI GameBench");
  assert.equal(brandTagline, "Benchmarking AI coding through games");
  assert.equal(brandTaglineZh, "用游戏评测 AI 编程能力");
});

test("the complete responsive brand asset family is present", async () => {
  await Promise.all([
    access(new URL("../public/carrick-logo.svg", import.meta.url)),
    access(new URL("../public/favicon.svg", import.meta.url)),
    access(new URL("../public/apple-touch-icon.png", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
    access(new URL("../public/fonts/Oxanium-Variable.ttf", import.meta.url)),
    access(new URL("../public/fonts/Silkscreen-Regular.ttf", import.meta.url)),
    access(new URL("../public/fonts/Silkscreen-Bold.ttf", import.meta.url)),
    access(new URL("../public/fonts/licenses/Oxanium-OFL.txt", import.meta.url)),
    access(new URL("../public/fonts/licenses/Silkscreen-OFL.txt", import.meta.url)),
  ]);
  const logo = await readFile(new URL("../public/carrick-logo.svg", import.meta.url), "utf8");
  assert.match(logo, /Carrick AI GameBench/);
  assert.match(logo, /#39C5BB/i);
});
