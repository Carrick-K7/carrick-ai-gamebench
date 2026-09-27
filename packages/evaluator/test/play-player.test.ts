import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parsePlayerDecision, RpcPlayPlayer, type PlayObservation } from "../src/play/player.js";

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const observation: PlayObservation = {
  turn_id: "turn-1", rules: "Use arrow keys", frame: { media_type: "image/png", data: "fixture" },
  remaining_decisions: 200, last_actions: [], memo: "",
};

async function fixture(mode: string, slotMilliseconds = 1_000): Promise<{ root: string; player: RpcPlayPlayer }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-player-"));
  const script = path.join(root, "fake.mjs");
  await writeFile(script, `
import { appendFileSync } from 'node:fs';
const mode = ${JSON.stringify(mode)};
const emit = value => process.stdout.write(JSON.stringify(value)+'\\n');
let buffer = '', observations = 0;
process.stdin.on('data', chunk => {
  buffer += chunk.toString('utf8');
  for (;;) {
    const i = buffer.indexOf('\\n'); if (i < 0) return;
    const request = JSON.parse(buffer.slice(0,i)); buffer = buffer.slice(i+1);
    if (request.type === 'init') { emit({type:'ready',protocol_version:1,identity:{agent:'pi',version:'0.84.3',provider:'fake',model:'fixture',thinking:'off'}}); continue; }
    if (request.type === 'finish') { emit({type:mode === 'bad-finish' ? 'broken-finish' : 'finished'}); continue; }
    appendFileSync('observations.jsonl',JSON.stringify(request)+'\\n');
    observations++;
    if (mode === 'stall') continue;
    if (mode === 'retry' && observations === 1) { emit({type:'error',turn_id:request.turn_id,kind:'transport',before_content:true,retryable:true,code:'HTTP_429'}); continue; }
    if (mode === 'partial') { emit({type:'content',turn_id:request.turn_id}); emit({type:'error',turn_id:request.turn_id,kind:'transport',before_content:true,retryable:true,code:'ECONNRESET'}); continue; }
    emit({type:'content',turn_id:request.turn_id});
    emit({type:'action',turn_id:mode === 'stale' ? 'other-turn' : request.turn_id,
      response_text:mode === 'invalid' ? 'not an action' : JSON.stringify({action:{type:'key',key:'ArrowLeft'},memo:'remember'}),
      usage:{input_tokens:5,output_tokens:6,cost:0.001}});
  }
});`);
  const player = new RpcPlayPlayer({
    command: `${quote(process.execPath)} ${quote(script)}`, cwd: root,
    stderrPath: path.join(root, "adapter.stderr.log"), slotMilliseconds,
  });
  await player.init("2048");
  return { root, player };
}

async function cleanup(f: { root: string; player: RpcPlayPlayer }): Promise<void> {
  await f.player.close();
  await rm(f.root, { recursive: true, force: true });
}

test("model decisions are strict native actions, not repaired text or privileged commands", () => {
  assert.deepEqual(parsePlayerDecision('{"action":{"type":"key","key":"ArrowLeft"}}'), { action: { type: "key", key: "ArrowLeft" } });
  for (const invalid of [
    '```json\n{"action":{"type":"key","key":"ArrowLeft"}}\n```',
    '{"action":{"type":"reset"}}', '{"action":{"type":"key","key":"F12"}}',
    '{"action":{"type":"click","button":"left","x":-1,"y":1}}',
    '{"action":{"type":"key","key":"ArrowLeft"},"source":"private"}',
    JSON.stringify({ action: { type: "key", key: "ArrowLeft" }, memo: "中".repeat(342) }),
  ]) assert.equal(parsePlayerDecision(invalid), undefined);
});

test("player channel strips private metadata and records a single native response", async () => {
  const f = await fixture("valid");
  try {
    const untrustedExtras = { ...observation, seed: 1234, private_state: { mine: true },
      frame: { ...observation.frame, private_snapshot: "secret" } };
    const result = await f.player.observe(untrustedExtras);
    assert.equal(result.status, "action");
    assert.deepEqual(result.action, { type: "key", key: "ArrowLeft" });
    assert.equal(result.memo, "remember");
    assert.equal(result.attempts.length, 1);
    assert.deepEqual(result.attempts[0]?.usage, { input_tokens: 5, output_tokens: 6, cost_estimate: 0.001, cost_source: "adapter-estimate" });
    const packet = JSON.parse((await readFile(path.join(f.root, "observations.jsonl"), "utf8")).trim());
    assert.equal(packet.seed, undefined);
    assert.equal(packet.private_state, undefined);
    assert.deepEqual(packet.frame, observation.frame);
    await assert.rejects(f.player.observe(observation), /duplicate player turn/);
  } finally { await cleanup(f); }
});

test("only explicit pre-content transport errors retry the identical pending observation", async () => {
  const f = await fixture("retry");
  try {
    const result = await f.player.observe(observation);
    assert.equal(result.status, "action");
    assert.deepEqual(result.attempts.map(({ status }) => status), ["transport-error", "action"]);
    const packets = (await readFile(path.join(f.root, "observations.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(packets.length, 2);
    assert.deepEqual(packets[0], packets[1]);
  } finally { await cleanup(f); }
});

test("content seen before an error prevents resampling even if adapter claims otherwise", async () => {
  const f = await fixture("partial");
  try {
    const result = await f.player.observe(observation);
    assert.equal(result.status, "infrastructure-failure");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.received_content, true);
  } finally { await cleanup(f); }
});

test("invalid model answers are budgeted outcomes; stale envelopes are infrastructure faults", async () => {
  for (const [mode, status] of [["invalid", "invalid"], ["stale", "infrastructure-failure"]]) {
    const f = await fixture(mode!);
    try {
      const result = await f.player.observe(observation);
      assert.equal(result.status, status);
      assert.equal(result.action, undefined);
      assert.equal(result.attempts.length, 1);
    } finally { await cleanup(f); }
  }
});

test("a healthy response cannot hide a broken finish/log-closure protocol", async () => {
  const f = await fixture("bad-finish");
  try {
    assert.equal((await f.player.observe(observation)).status, "action");
    await assert.rejects(f.player.close(), /finish reply/);
    await assert.rejects(f.player.observe({ ...observation, turn_id: "closed" }), /not ready/);
  } finally { await cleanup(f); }
});

test("an unanswered slot times out without issuing another model request", async () => {
  const f = await fixture("stall", 25);
  try {
    const result = await f.player.observe(observation);
    assert.equal(result.status, "timeout");
    assert.equal(result.attempts.length, 1);
    assert.equal((await readFile(path.join(f.root, "observations.jsonl"), "utf8")).trim().split("\n").length, 1);
  } finally { await cleanup(f); }
});
