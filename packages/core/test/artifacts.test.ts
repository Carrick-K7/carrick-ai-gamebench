import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  sha256File,
  verifyEvidenceManifest,
  writeEvidenceManifest,
} from "../src/index.js";

test("evidence verification rejects changed and unlisted artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-evidence-"));
  try {
    const archivePath = path.join(root, "source.tar.zst");
    await writeFile(archivePath, "source", "utf8");
    await writeFile(
      path.join(root, "source.sha256"),
      `${await sha256File(archivePath)}  source.tar.zst\n`,
      "utf8",
    );
    await writeEvidenceManifest(root);
    assert.equal((await verifyEvidenceManifest(root)).valid, true);

    await writeFile(path.join(root, "extra.log"), "extra", "utf8");
    const withExtra = await verifyEvidenceManifest(root);
    assert.equal(withExtra.valid, false);
    assert.ok(withExtra.errors.includes("unlisted artifact: extra.log"));

    await rm(path.join(root, "extra.log"));
    await writeFile(archivePath, "changed", "utf8");
    const changed = await verifyEvidenceManifest(root);
    assert.equal(changed.valid, false);
    assert.ok(changed.errors.includes("digest mismatch: source.tar.zst"));
    assert.ok(changed.errors.includes("source archive digest mismatch"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
