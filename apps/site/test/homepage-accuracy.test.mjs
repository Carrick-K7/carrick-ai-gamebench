import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resultData, score } from "../src/lib/data.ts";
import { publicOverviewRecords, rankingMetricForVersion } from "../src/lib/ranking.ts";

const row = (tier, score, version = "0.6.0", status = "active") => ({
  entry: { tier, benchmark_version: version, status, aggregate: { primary_board: "build", leaderboards: { build: score } } },
});
const homepageSource = () => readFile(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const layoutSource = () => readFile(new URL("../src/layouts/Layout.astro", import.meta.url), "utf8");

function suiteCard(page, suite) {
  const match = page.match(new RegExp(`<article[^>]*data-suite="${suite}"[^>]*>([\\s\\S]*?)<\\/article>`));
  assert.ok(match, `homepage has a separate ${suite} card`);
  return match[1];
}

function bilingualLink(source, href, english, chinese) {
  const links = [...source.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const link = links.find(([, target, content]) =>
    target === href && content.includes(english) && content.includes(chinese));
  assert.ok(link, `${href} has English and Chinese labels: ${english} / ${chinese}`);
  assert.match(link[2], /class="lang-en"/);
  assert.match(link[2], /class="lang-zh"/);
}

test("homepage counts Official and Experimental without merging qualification or versions", () => {
  const records = [row("experimental", 100), row("official", 80), row("official", 90),
    row("official", 99, "0.6.1"), row("official", 97, "0.6.0", "withdrawn")];
  const selected = publicOverviewRecords(records, "0.6.0");
  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map(({ entry }) => [entry.tier, entry.aggregate.leaderboards.build]), [
    ["official", 90], ["official", 80], ["experimental", 100],
  ]);
  assert.equal(records[0].entry.tier, "experimental", "selection must not mutate source ordering");
  assert.deepEqual(publicOverviewRecords(records, "0.7.0"), []);
});

test("all published v0.6.0 Official observations appear in the overview", async () => {
  const previousRoot = process.env.GAMEBENCH_RESULTS_ROOT;
  delete process.env.GAMEBENCH_RESULTS_ROOT;
  try {
    const { records } = await resultData();
    const expected = records.filter(({ entry }) => entry.benchmark_version === "0.6.0" && entry.status === "active");
    assert.ok(expected.some(({ entry }) => entry.tier === "official"));
    assert.equal(publicOverviewRecords(records, "0.6.0").length, expected.length);
  } finally {
    if (previousRoot === undefined) delete process.env.GAMEBENCH_RESULTS_ROOT;
    else process.env.GAMEBENCH_RESULTS_ROOT = previousRoot;
  }
});

test("overview retains absent Build metrics rather than displaying fake zero scores", () => {
  const records = [row("official", undefined), row("official", 0)];
  const selected = publicOverviewRecords(records, "0.6.0");
  assert.deepEqual(selected.map(({ entry }) => rankingMetricForVersion(entry.aggregate)), [0, undefined]);
  assert.equal(score(undefined), "—");
  assert.equal(score(0), "0.0", "a measured zero is different from an absent measurement");
});

test("overview does not promise nonexistent playables or invent ordinal ranks", async () => {
  const page = await homepageSource();
  assert.ok(page.includes("publicOverviewRecords(activeRecords, resultVersion)"));
  assert.ok(page.includes("publicRecords.length"));
  assert.ok(!page.includes("experimental.length"));
  assert.ok(!page.includes("Every score links back to the exact playable output"));
  assert.ok(page.includes("featured.length > 0"));
  assert.ok(page.includes("return playable && showcase ?"));
  assert.ok(page.includes("Playable builds and downloadable evidence are shown when published."));
  assert.ok(page.includes("可玩成品和可下载证据只在实际公开时展示。"));
  assert.ok(page.includes("A frozen source hash does not mean the game files are publicly hosted."));
  assert.ok(page.includes("Public source downloads and full evidence are separate, explicitly labeled artifacts."));
  assert.ok(page.includes('run.score?.percent.toFixed(0) ?? "—"'));
  assert.ok(page.includes("score(rankingMetricForEntry(entry))"));
  assert.doesNotMatch(page, /(?:\?\?|\|\|)\s*["']?0\b/);
  assert.ok(!page.includes("String(index + 1).padStart"));
});

test("header keeps historical routes and adds bilingual Build, Play, and unranked reference practice", async () => {
  const layout = await layoutSource();
  const navigation = layout.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  bilingualLink(navigation, "/leaderboard", "Build · coding agents", "Build · 编程智能体");
  bilingualLink(navigation, "/play", "Play · visual players", "Play · 视觉玩家");
  bilingualLink(navigation, "/play#practice", "Practice · unranked", "参考练习 · 不计排名");
  bilingualLink(navigation, "/games", "Build games", "Build 游戏");
  for (const route of ["/leaderboard", "/games", "/methodology", "/releases"]) {
    assert.ok(navigation.includes(`href="${route}"`), `historical route ${route} stays linked`);
  }
  assert.ok(navigation.includes("href={githubUrl}"));
  assert.doesNotMatch(navigation, />Play games<|>玩游戏</);
  assert.ok(layout.includes('window.addEventListener("hashchange", updateActiveNavigation)'));
  assert.ok(layout.includes('.grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }'));
  assert.match(layout, /@media \(max-width: 620px\)[\s\S]*\.grid\.cols-2, \.grid\.cols-3, \.grid\.cols-4 \{ grid-template-columns: 1fr; \}/);
});

test("bilingual hero distinguishes frozen Build deliveries from live visual Play systems", async () => {
  const page = await homepageSource();
  const hero = page.match(/<section class="hero">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(hero);
  assert.ok(hero.includes("measures what coding agents deliver"));
  assert.ok(hero.includes("编程智能体交付的冻结浏览器游戏"));
  assert.ok(hero.includes("model, player harness, and configuration"));
  assert.ok(hero.includes("playing fixed maintainer-owned games through screenshots and native actions"));
  assert.ok(hero.includes("通过截图和原生操作游玩维护者提供的固定游戏"));
  assert.ok(hero.includes("No combined suite score. No cross-game Play score."));
  assert.ok(hero.includes("Build 与 Play 不合并计分；Play 不设跨游戏总分。"));
  bilingualLink(hero, "/leaderboard", "Build · coding-agent results", "Build · 编程智能体成绩");
  bilingualLink(hero, "/play", "Play · visual player systems", "Play · 视觉玩家系统");
  bilingualLink(hero, "/play#practice", "unranked practice", "不计排名");
  assert.doesNotMatch(hero, /Play (?:results are published|champion|score:)/);
});

test("Play selects an independent result-bearing version and has an honest bilingual empty state", async () => {
  const page = await homepageSource();
  assert.match(page, /import\s*\{[^}]*latestPlayResultBearingVersion[^}]*playReleases[^}]*playResults[^}]*\}\s*from "\.\.\/lib\/play-data\.ts"/);
  assert.match(page, /const playResultVersion = latestPlayResultBearingVersion\(playReleaseViews,\s*qualifiedPlayResults\);/,
    "Play must not fall back to the newest lock or Build result version when no Play result exists");
  assert.ok(page.includes("latestResultBearingVersion(releases, results.records)"));
  const build = suiteCard(page, "build");
  const play = suiteCard(page, "play");
  assert.ok(build.includes("publicRecords.length"));
  assert.ok(build.includes("Latest result-bearing Build version:"));
  assert.doesNotMatch(build, /qualifiedPlayResults|\{playResultVersion\}/);
  assert.doesNotMatch(play, /publicRecords|\{resultVersion\}|games\.length/);
  assert.ok(play.includes("playResultVersion !== undefined ?"));
  assert.ok(play.includes("Latest result-bearing Play version:"));
  assert.ok(play.includes("最新有成绩的 Play 版本："));
  assert.ok(play.includes("No measured Play results published yet."));
  assert.ok(play.includes("尚无公开的 Play 实测成绩。"));
  assert.ok(play.includes("Reference games and protocol documentation are not benchmark results"));
  assert.ok(play.includes("2048 mean score and Minesweeper win rate have separate rankings."));
  assert.ok(play.includes("2048 平均原生分数与扫雷胜率分别排行，不设 Play 总分。"));
  assert.ok(play.includes("not an agent writing a solver, and not games generated by Build agents"));
  assert.ok(play.includes("Human practice is unranked, with no model calls or online submissions."));
  assert.ok(play.includes("人类练习不计排名，不调用模型，也不在线提交成绩。"));
  bilingualLink(play, "/play", "per-game rankings", "各游戏排行");
  bilingualLink(play, "/play#practice", "Reference practice · unranked", "参考游戏练习 · 不计排名");
  assert.doesNotMatch(page, /play\.score|overallPlayScore|combinedSuiteScore/);
});

test("V4 instrument locks are not described as published Build or Play releases", async () => {
  const page = await homepageSource();
  assert.ok(page.includes("const currentBuildIsInstrumentLock = currentRelease?.schema_version === 4;"));
  assert.ok(page.includes('currentBuildIsInstrumentLock ? "current Build instrument lock" : "current Build release"'));
  assert.ok(page.includes('currentBuildIsInstrumentLock ? "当前 Build 评测锁定版本" : "当前 Build 发布版本"'));
  const play = suiteCard(page, "play");
  assert.ok(play.includes("Latest Play instrument lock:"));
  assert.ok(play.includes("最新 Play 评测锁定版本："));
  assert.ok(play.includes("A source lock is not a published release or a measurement."));
  assert.doesNotMatch(play, /Latest Play release:|最新 Play 发布版本：/);
});

test("homepage and footer explain LLM Showcase as demos, not benchmark rankings", async () => {
  const [page, layout] = await Promise.all([homepageSource(), layoutSource()]);
  for (const source of [page, layout]) {
    assert.ok(source.includes('href="https://llm-showcase.carrick7.com/"'));
    assert.ok(source.includes("demos, not benchmark rankings"));
  }
  assert.ok(page.includes("是独立的前端作品展示，不是评测排行榜"));
  assert.ok(page.includes("It does not supply GameBench scores or the fixed Play game set."));
  assert.ok(layout.includes("作品展示，非评测排行"));
});
