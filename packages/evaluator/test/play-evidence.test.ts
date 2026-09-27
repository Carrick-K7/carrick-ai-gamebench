import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlayEvidenceVerifier, sealPlayEvidence, verifyPlayEvidence } from "../src/play/evidence.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cagb-evidence-cache-"));
  const task = path.join(root, "tasks", "play.2048.v1");
  const episode = path.join(task, "episodes", "000");
  await fs.mkdir(episode, { recursive: true });
  const frame = path.join(episode, "frame.png");
  await fs.writeFile(frame, "original-frame");
  const episodeHash = await sealPlayEvidence(episode);
  const taskHash = await sealPlayEvidence(task);
  const rootHash = await sealPlayEvidence(root);
  return { root, task, episode, frame, episodeHash, taskHash, rootHash };
}

test("one series check hashes unchanged nested frame bytes once, with no cross-check cache", async (t) => {
  const f = await fixture();
  const originalRead = fs.readFile;
  let frameReads = 0;
  t.mock.method(fs, "readFile", (file: Parameters<typeof fs.readFile>[0], ...args: unknown[]) => {
    if (file === f.frame) frameReads++;
    return Reflect.apply(originalRead, fs, [file, ...args]);
  });
  try {
    const evidence = new PlayEvidenceVerifier();
    await evidence.verify(f.root, f.rootHash);
    await evidence.verify(f.task, f.taskHash);
    await evidence.verify(f.episode, f.episodeHash);
    await evidence.verify(f.episode, f.episodeHash); // replay inside this check
    assert.equal(frameReads, 1);
    await verifyPlayEvidence(f.episode, f.episodeHash); // independent replay/check
    assert.equal(frameReads, 2);
    await assert.rejects(evidence.verify(f.episode, `sha256:${"0".repeat(64)}`), /identity mismatch/);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test("cached seals reject same-size tampering even when mtime is restored", async () => {
  const f = await fixture();
  try {
    const evidence = new PlayEvidenceVerifier();
    await evidence.verify(f.root);
    const before = await fs.stat(f.frame);
    await fs.writeFile(f.frame, "modified-frame");
    await fs.utimes(f.frame, before.atime, before.mtime);
    await assert.rejects(evidence.verify(f.episode), /sealed manifest/);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test("cached seals still validate directory membership, nested manifests and links", async () => {
  for (const change of ["extra", "manifest", "symlink", "hardlink"] as const) {
    const f = await fixture();
    try {
      const evidence = new PlayEvidenceVerifier();
      await evidence.verify(f.root);
      if (change === "extra") await fs.writeFile(path.join(f.episode, "unlisted"), "extra");
      if (change === "manifest") await fs.writeFile(path.join(f.episode, "MANIFEST.sha256"), "forged seal\n");
      if (change === "symlink") await fs.symlink(f.frame, path.join(f.episode, "link"));
      if (change === "hardlink") await fs.link(f.frame, path.join(f.episode, "link"));
      await assert.rejects(evidence.verify(f.task, f.taskHash), /sealed manifest|symlink|singly-linked/);
    } finally { await fs.rm(f.root, { recursive: true, force: true }); }
  }
});
