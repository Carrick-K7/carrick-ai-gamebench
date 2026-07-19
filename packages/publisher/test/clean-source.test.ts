import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256File } from "@carrick/gamebench-core";
import {
  FilesystemArtifactStore,
  exportCleanSource,
  preparePublicArtifacts,
} from "../src/index.js";

async function fixture(root: string): Promise<string> {
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "dist"), { recursive: true });
  await writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({ name: "game" }),
    "utf8",
  );
  await writeFile(path.join(workspace, "src", "main.ts"), "export {};\n", "utf8");
  await writeFile(
    path.join(workspace, "dist", "index.html"),
    '<link rel="stylesheet" href="/assets/game.css"><main>game</main>',
    "utf8",
  );
  await writeFile(path.join(workspace, ".env"), "OPENAI_API_KEY=secret", "utf8");
  await writeFile(path.join(workspace, "trajectory.jsonl"), "private", "utf8");
  return workspace;
}

test("clean source export is allowlisted and deterministic", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-publisher-"));
  try {
    const workspace = await fixture(root);
    const first = await preparePublicArtifacts(workspace, path.join(root, "first"));
    const second = await preparePublicArtifacts(workspace, path.join(root, "second"));
    assert.equal(await sha256File(first.sourceArchive), await sha256File(second.sourceArchive));
    assert.equal(
      await readFile(path.join(first.playable, "index.html"), "utf8"),
      '<link rel="stylesheet" href="./assets/game.css"><main>game</main>',
    );

    const store = new FilesystemArtifactStore(path.join(root, "objects"), "/");
    const source = await store.put(first.sourceArchive, {
      role: "clean-source",
      fileName: "clean-source.tar.zst",
      mediaType: "application/zstd",
    });
    const playable = await store.put(first.playable, {
      role: "playable",
      fileName: "index.html",
      mediaType: "text/html",
      kind: "directory",
    });
    assert.equal(await store.exists(source), true);
    assert.equal(await store.exists(playable), true);
    assert.match(source.url, /^\/objects\/sha256\//);
    assert.match(playable.url, /^\/play\/[a-f0-9]{64}\/index\.html$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("secret scanning rejects credentials inside publishable source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-secret-"));
  try {
    const workspace = await fixture(root);
    await writeFile(
      path.join(workspace, "src", "config.ts"),
      'export const key = "sk-abcdefghijklmnopqrstuvwxyz123456";\n',
      "utf8",
    );
    await assert.rejects(
      exportCleanSource(workspace, path.join(root, "clean")),
      /secret scan failed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
