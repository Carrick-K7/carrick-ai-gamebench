// Offline post-build smoke. Reuses the repository's installed browser tooling;
// requests are fulfilled from dist in-process: no server, provider, or network.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseCatalogData, resultData } from "../src/lib/data.ts";
import { playReleases } from "../src/lib/play-data.ts";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const html = (route) => readFile(path.join(dist, route, "index.html"), "utf8");
const catalogs = await releaseCatalogData();
const { records } = await resultData();
let retainedRoutes = 0;
for (const { release, tasks } of catalogs) {
  for (const route of [`releases/${release.benchmark_version}`, `benchmarks/${release.benchmark_version}/leaderboard`, `benchmarks/${release.benchmark_version}/games`, ...tasks.map((task) => `benchmarks/${release.benchmark_version}/games/${task.id}`)]) {
    assert.ok((await html(route)).includes("<!DOCTYPE html>"), route);
    retainedRoutes++;
  }
}
for (const record of records) {
  const { entry } = record;
  const detail = await html(`results/${entry.publication_id.slice(7)}`);
  assert.ok(detail.includes(entry.publication_id), "exact immutable result identity remains visible");
  if ("result" in record) {
    assert.match(detail, /data-result-format="flat-build"/);
    assert.doesNotMatch(detail, /<th>Variation<|Evaluator image|submissions verified/);
    for (const task of record.result.tasks) {
      assert.ok(detail.includes(task.source_hash), "flat source hash is shown directly");
      assert.ok(detail.includes(task.artifact_manifest_hash), "manifest identity is not a download");
      assert.ok(detail.includes(`id="task-${task.task_id}"`));
    }
  } else {
    assert.doesNotMatch(detail, /data-result-format="flat-build"/);
    for (const run of record.publication.runs) {
      assert.ok(detail.includes(`id="evaluation-${run.run_id}"`), "historical evaluation fragment is unchanged");
    }
  }
  retainedRoutes++;
}
const historic = await html("benchmarks/0.6.0/leaderboard");
assert.equal((historic.match(/<tr\b[^>]*>/g) ?? []).length, 8, "seven v0.6 rows plus one header");
for (const release of await playReleases()) {
  for (const game of ["2048", "minesweeper"]) {
    const page = await html(`play/${release.benchmark_version}/${game}`);
    assert.match(page, /id="official"/);
    assert.match(page, /id="experimental"/);
    if (release.benchmark_version === "0.7.0") {
      assert.match(page, /No Official measured/);
      assert.match(page, /No Experimental measured/);
      assert.doesNotMatch(page, /<tbody\b/);
    }
  }
}

const { chromium } = createRequire(new URL("../../../packages/evaluator/package.json", import.meta.url))("@playwright/test");
const browser = await chromium.launch({ headless: true });
const errors = [];
const unexpected = [];
const origin = "http://site-smoke.invalid";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf" };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || !["GET", "HEAD"].includes(route.request().method())) {
      unexpected.push(route.request().url());
      return route.abort();
    }
    let target = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    assert.ok(target === dist.slice(0, -1) || target.startsWith(dist), "asset remains inside dist");
    try {
      if ((await stat(target)).isDirectory()) target = path.join(target, "index.html");
      return route.fulfill({ status: 200, body: await readFile(target), contentType: mime[path.extname(target)] ?? "application/octet-stream" });
    } catch (error) {
      errors.push(`missing built asset: ${url.pathname}: ${error}`);
      return route.fulfill({ status: 404, body: "missing" });
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/`);
  await page.locator('html[data-language-ready="true"]').waitFor();
  assert.ok(await page.locator('.hero a[href="/leaderboard"]').isVisible());
  assert.ok(await page.locator('.hero a[href="/play"]').isVisible());
  assert.match(await page.locator('[data-suite="play"]').innerText(), /No measured Play results/);
  await page.locator("[data-language-toggle]").click();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  assert.match(await page.locator('[data-suite="play"]').innerText(), /尚无公开的 Play 实测成绩/);

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const game of ["2048", "minesweeper"]) {
      await page.goto(`${origin}/play/practice/${game}/?lang=en`);
      const mount = page.locator(`#play-renderer-${game}`);
      await mount.locator(":scope > div").first().waitFor({ state: "visible" });
      await page.waitForFunction((id) => document.getElementById(id)?.hidden, `play-status-${game}`);
      const board = mount.locator(":scope > div").nth(1);
      assert.equal(await board.locator(":scope > div").count(), game === "2048" ? 16 : 100);
      const box = await board.boundingBox();
      const frame = await page.locator(`#play-stage-${game}`).boundingBox();
      assert.ok(box.x >= frame.x - 1 && box.y >= frame.y - 1 && box.x + box.width <= frame.x + frame.width + 1 && box.y + box.height <= frame.y + frame.height + 1, `${game} board fits scaled frame at ${width}px`);
      assert.ok(frame.x + frame.width <= width + 1, "practice fits mobile width");
      const before = await board.innerHTML();
      if (game === "2048") {
        for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight"]) await page.keyboard.press(key);
      } else {
        const cell = board.locator(":scope > div").first();
        await cell.click({ button: "right" });
        assert.equal(await cell.locator("svg").count(), 1, "native right click flags");
        await cell.click({ button: "right" });
        assert.equal(await cell.locator("svg").count(), 0);
        await cell.click();
      }
      assert.notEqual(await board.innerHTML(), before, `${game} native input changes the reference board`);
      await page.locator(`#play-restart-${game}`).click();
      assert.equal(await mount.locator(":scope > div").nth(1).locator(":scope > div").count(), game === "2048" ? 16 : 100, "restart does not duplicate the renderer");
      assert.equal(await page.locator(`#play-status-${game}`).isVisible(), false);
    }
  }
  assert.deepEqual(unexpected, [], "no provider/server/external requests");
  assert.deepEqual(errors, [], "no browser errors or missing assets");
  console.log(`Verified ${retainedRoutes} retained version/result routes, 7 historical rows, separate empty Play tiers, bilingual homepage, and both original practice games at desktop/mobile widths; no server or external requests.`);
} finally {
  await browser.close();
}
