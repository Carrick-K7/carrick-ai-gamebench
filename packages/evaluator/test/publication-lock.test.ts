import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquirePublicationIndexLock,
  ensurePublicationDirectory,
} from "../src/publication-lock.js";

test("publication directories reject symlink escape", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-publication-root-"));
  try {
    const repositoryRoot = path.join(temporary, "repo");
    const outside = path.join(temporary, "outside");
    await mkdir(path.join(repositoryRoot, "results"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(repositoryRoot, "results", "lite"));
    await assert.rejects(
      ensurePublicationDirectory(repositoryRoot, "0.6.0"),
      /not a real directory/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("an empty or malformed lock never steals an initializing writer's ownership", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-index-lock-owner-"));
  const lockPath = path.join(temporary, "index.lock");
  try {
    for (const content of ["", "not-a-pid\n", "0\n"]) {
      await writeFile(lockPath, content);
      await assert.rejects(acquirePublicationIndexLock(lockPath), /unconfirmed owner; inspect/);
      assert.equal(await readFile(lockPath, "utf8"), content);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("publication index lock serializes writers and never automatically reclaims stale owners", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-index-lock-"));
  const lockPath = path.join(temporary, "index.lock");
  try {
    const release = await acquirePublicationIndexLock(lockPath);
    await assert.rejects(
      acquirePublicationIndexLock(lockPath),
      /locked by process/,
    );
    await release();
    const releaseAgain = await acquirePublicationIndexLock(lockPath);
    await releaseAgain();
    await writeFile(lockPath, "999999999\n");
    await Promise.all([0, 1].map(() => assert.rejects(
      acquirePublicationIndexLock(lockPath), /stale process.*confirm no publisher/,
    )));
    assert.equal(await readFile(lockPath, "utf8"), "999999999\n");
    // Explicit operator cleanup after inspection, never an automatic takeover.
    await rm(lockPath);
    const releaseAfterCleanup = await acquirePublicationIndexLock(lockPath);
    await releaseAfterCleanup();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
