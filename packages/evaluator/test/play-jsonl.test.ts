import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonlProcess, JsonlProcessError } from "../src/play/jsonl-process.js";

function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

async function fixture(source: string): Promise<{ root: string; process: JsonlProcess }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-jsonl-"));
  const script = path.join(root, "adapter.mjs");
  await writeFile(script, source);
  return { root, process: new JsonlProcess(`${quote(process.execPath)} ${quote(script)}`, {
    cwd: root, stderrPath: path.join(root, "stderr.log"),
  }) };
}

test("adapter transport uses LF-only framing and preserves split UTF-8", async () => {
  const f = await fixture(`
const packet = Buffer.from(JSON.stringify({ memo: '中文\\u2028still one record' }) + '\\r\\n');
process.stdout.write(packet.subarray(0, 11));
setTimeout(() => process.stdout.write(packet.subarray(11)), 5);
let text = '';
process.stdin.on('data', chunk => {
  text += chunk.toString('utf8');
  if (text.includes('\\n')) {
    process.stderr.write('private diagnostic\\n');
    process.stdout.write(JSON.stringify({ echo: JSON.parse(text) }) + '\\n');
  }
});
`);
  try {
    assert.deepEqual(await f.process.read(2_000), { memo: "中文\u2028still one record" });
    await f.process.send({ turn_id: "turn-1", message: "hello" });
    assert.deepEqual(await f.process.read(2_000), { echo: { turn_id: "turn-1", message: "hello" } });
  } finally {
    await f.process.close();
    assert.equal(await readFile(path.join(f.root, "stderr.log"), "utf8"), "private diagnostic\n");
    await rm(f.root, { recursive: true, force: true });
  }
});

test("adapter timeout and cancellation do not cause automatic requests", async () => {
  const f = await fixture("process.stdin.resume();");
  try {
    await assert.rejects(f.process.read(10), (error: unknown) => error instanceof JsonlProcessError && error.kind === "timeout");
    const controller = new AbortController();
    const pending = f.process.read(2_000, controller.signal);
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof JsonlProcessError && error.kind === "aborted");
  } finally {
    await f.process.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("adapter malformed and unterminated records are explicit protocol errors", async () => {
  for (const source of [
    "process.stdout.write('not-json\\n'); process.stdin.resume();",
    "process.stdout.write(JSON.stringify({ ok: true }));",
  ]) {
    const f = await fixture(source);
    try {
      await assert.rejects(f.process.read(2_000), (error: unknown) => error instanceof JsonlProcessError && error.kind === "protocol");
    } finally {
      await f.process.close();
      await rm(f.root, { recursive: true, force: true });
    }
  }
});
