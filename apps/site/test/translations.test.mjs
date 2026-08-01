import assert from "node:assert/strict";
import test from "node:test";

import { translateToZh } from "../src/lib/translations.ts";

test("primary navigation and public score language have Chinese equivalents", () => {
  const examples = new Map([
    ["Play games", "玩游戏"],
    ["Rankings", "评测排行"],
    ["Evaluation rules", "评测规则"],
    ["Benchmark releases", "测试集版本"],
    ["Source", "源码"],
    ["Benchmarking AI coding through games", "用游戏评测 AI 编程能力"],
    ["Core · Build and Reproduce combined", "综合分 · 构建和复刻各占一半"],
    ["The browser can check rules. It cannot tell us whether a game feels clear, polished, or enjoyable.", "自动测试能检查规则是否正确，但判断不了画面是否清楚、完成度够不够、游戏好不好玩。"],
  ]);

  for (const [source, expected] of examples) {
    assert.equal(translateToZh(source), expected);
  }
});

test("dynamic benchmark labels translate without enumerating every version or seed", () => {
  const examples = new Map([
    ["v0.3.0 games", "v0.3.0 游戏"],
    ["Official season · v0.3.0", "正式版本 · v0.3.0"],
    ["5 playable builds", "5 个版本可玩"],
    ["test seed 104729", "测试种子 104729"],
    ["Score 90.0 · Completed", "分数 90.0 · 已完成"],
    ["8 tasks · 0 active Official results", "8 个任务 · 0 个有效正式结果"],
    ["3/8 runs verified", "3/8 次运行已验证"],
  ]);

  for (const [source, expected] of examples) {
    assert.equal(translateToZh(source), expected);
  }
});

test("unknown model names and technical identifiers remain unchanged", () => {
  assert.equal(translateToZh("gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(translateToZh("sha256:abc123"), "sha256:abc123");
  assert.equal(translateToZh("build.2048.v2"), "build.2048.v2");
});
