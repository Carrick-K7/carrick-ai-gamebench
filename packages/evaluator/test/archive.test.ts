import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  materializeSubmissionArchive,
  sealSubmissionWorkspace,
  withMaterializedSubmission,
} from "../src/archive.js";

async function temporaryRoot(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "cagb-archive-test-"));
}

test("sealed submissions are deterministic and exclude build state", async () => {
  const root = await temporaryRoot();
  try {
    const workspace = path.join(root, "workspace");
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await mkdir(path.join(workspace, "dist"), { recursive: true });
    await mkdir(path.join(workspace, "node_modules"), { recursive: true });
    await writeFile(path.join(workspace, "src", "main.ts"), "export const value = 1;\n");
    await writeFile(path.join(workspace, "dist", "bundle.js"), "generated\n");
    await writeFile(path.join(workspace, "node_modules", "cache"), "generated\n");
    const first = await sealSubmissionWorkspace(
      workspace,
      path.join(root, "first.tar.zst"),
      path.join(root, "archive.log"),
    );
    const second = await sealSubmissionWorkspace(
      workspace,
      path.join(root, "second.tar.zst"),
      path.join(root, "archive.log"),
    );
    assert.equal(first.sourceSnapshotHash, second.sourceSnapshotHash);

    await withMaterializedSubmission(
      first.archivePath,
      first.sourceSnapshotHash,
      path.join(root, "extract.log"),
      async (materialized) => {
        assert.equal(
          await readFile(path.join(materialized, "src", "main.ts"), "utf8"),
          "export const value = 1;\n",
        );
        await assert.rejects(readFile(path.join(materialized, "dist", "bundle.js")));
        await assert.rejects(readFile(path.join(materialized, "node_modules", "cache")));
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive materialization rejects a hash mismatch", async () => {
  const root = await temporaryRoot();
  try {
    const workspace = path.join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "index.html"), "ok\n");
    const sealed = await sealSubmissionWorkspace(
      workspace,
      path.join(root, "source.tar.zst"),
      path.join(root, "archive.log"),
    );
    await assert.rejects(
      materializeSubmissionArchive(
        sealed.archivePath,
        `sha256:${"0".repeat(64)}`,
        path.join(root, "output"),
        path.join(root, "extract.log"),
      ),
      /archive hash mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("submission sealing rejects symbolic links", async () => {
  const root = await temporaryRoot();
  try {
    const workspace = path.join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(root, "outside.txt"), "outside\n");
    await symlink(path.join(root, "outside.txt"), path.join(workspace, "escape"));
    await assert.rejects(
      sealSubmissionWorkspace(
        workspace,
        path.join(root, "source.tar.zst"),
        path.join(root, "archive.log"),
      ),
      /symbolic link/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
