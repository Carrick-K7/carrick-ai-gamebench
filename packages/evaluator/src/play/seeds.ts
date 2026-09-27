import { randomInt } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import {
  PLAY_DEFAULT_EPISODES, PlaySeedBundleSchema, PlaySeedCommitmentSchema,
  assertPlaySeedBundleCommitment, playSeedBundleHash,
  type PlaySeedBundle, type PlaySeedCommitment, type ReleaseLockV4,
} from "@carrick/gamebench-core";
import { playEqual } from "./slot-audit.js";

export function createPlaySeedBundle(release: ReleaseLockV4): PlaySeedBundle {
  return PlaySeedBundleSchema.parse({
    schema_version: 1, benchmark_version: release.benchmark_version,
    tasks: release.suites.play.tasks.map((task) => {
      const seeds = new Set<number>();
      while (seeds.size < PLAY_DEFAULT_EPISODES) seeds.add(randomInt(0, 0x1_0000_0000));
      return { task_id: task.id, seeds: [...seeds] };
    }),
  });
}

export function createPlaySeedCommitment(bundleInput: PlaySeedBundle): PlaySeedCommitment {
  const bundle = PlaySeedBundleSchema.parse(bundleInput);
  return PlaySeedCommitmentSchema.parse({
    schema_version: 1, benchmark_version: bundle.benchmark_version,
    seed_bundle_hash: playSeedBundleHash(bundle),
    tasks: bundle.tasks.map((task) => ({ task_id: task.task_id, episodes: task.seeds.length })),
  });
}

export function assertReleasedPlaySeeds(bundleInput: PlaySeedBundle, release: ReleaseLockV4, commitment?: PlaySeedCommitment): PlaySeedBundle {
  const bundle = PlaySeedBundleSchema.parse(bundleInput);
  if (bundle.benchmark_version !== release.benchmark_version || !playEqual(bundle.tasks.map((task) => task.task_id), release.suites.play.tasks.map((task) => task.id))) throw new Error("seed bundle must cover the exact released Play games in order");
  if (commitment) {
    if (!playEqual(createPlaySeedCommitment(bundle), commitment)) throw new Error("seed commitment differs from the private bundle");
    assertPlaySeedBundleCommitment(bundle, commitment);
  }
  return bundle;
}

/** Never overwrite a prior bundle: regeneration would silently resample a campaign. */
export async function writePrivatePlaySeedBundle(filePath: string, bundle: PlaySeedBundle): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(PlaySeedBundleSchema.parse(bundle), null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export async function readPrivatePlaySeedBundle(filePath: string): Promise<PlaySeedBundle> {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw new Error("private seed bundle must be an owner-only regular file, not a link");
  return PlaySeedBundleSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}
