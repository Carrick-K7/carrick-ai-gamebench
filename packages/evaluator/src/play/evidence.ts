import { createHash } from "node:crypto";
import { promises as fs, type BigIntStats } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validatePlayTask, type LoadedPlayTask } from "@carrick/gamebench-core";

export function playBytesHash(bytes: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** No symlinks, hardlinks or special files are part of a frozen Play record. */
async function regularFiles(root: string, current = root): Promise<string[]> {
  const directory = await lstat(current);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Play evidence directory must be a real directory");
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (/[\\\r\n]/.test(entry.name)) throw new Error("unsafe Play evidence filename");
    const absolute = path.join(current, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("Play evidence may not contain symlinks");
    if (stat.isDirectory()) files.push(...await regularFiles(root, absolute));
    else if (stat.isFile() && stat.nlink === 1) {
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (relative !== "MANIFEST.sha256") files.push(relative);
    } else throw new Error("Play evidence may contain only singly-linked regular files");
  }
  return files.sort();
}

async function manifestText(
  root: string,
  hashFile = async (file: string) => playBytesHash(await fs.readFile(file)),
): Promise<string> {
  const entries: string[] = [];
  for (const relative of await regularFiles(root)) {
    entries.push(`${(await hashFile(path.join(root, relative))).slice(7)}  ${relative}`);
  }
  return `${entries.join("\n")}\n`;
}

/** Nested episode manifests are sealed too; only this directory's seal is excluded. */
export async function sealPlayEvidence(root: string): Promise<`sha256:${string}`> {
  const text = await manifestText(root);
  await writeFile(path.join(root, "MANIFEST.sha256"), text, { flag: "wx", mode: 0o600 });
  return playBytesHash(text);
}

function fileStamp(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

/** One check's byte-hash cache, not a persistent trust cache. Nested seals still
 * check their exact listings, file kinds, manifest bytes and expected identity.
 * Changed files (including same-size edits with restored mtime) are re-read.
 */
export class PlayEvidenceVerifier {
  private readonly hashes = new Map<string, { stamp: string; hash: `sha256:${string}` }>();

  private async hashFile(file: string): Promise<`sha256:${string}`> {
    const absolute = path.resolve(file);
    const stat = await lstat(absolute, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n) throw new Error("Play evidence may contain only singly-linked regular files");
    const stamp = fileStamp(stat);
    const cached = this.hashes.get(absolute);
    if (cached?.stamp === stamp) return cached.hash;
    const hash = playBytesHash(await fs.readFile(absolute));
    if (fileStamp(await lstat(absolute, { bigint: true })) !== stamp) throw new Error("Play evidence changed while being hashed");
    this.hashes.set(absolute, { stamp, hash });
    return hash;
  }

  async verify(root: string, expected?: string): Promise<`sha256:${string}`> {
    const manifestPath = path.join(root, "MANIFEST.sha256");
    const stat = await lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("invalid Play evidence seal file");
    const text = await readFile(manifestPath, "utf8");
    const hash = playBytesHash(text);
    if (expected && hash !== expected) throw new Error("Play evidence manifest identity mismatch");
    if (text !== await manifestText(root, (file) => this.hashFile(file))) throw new Error("Play evidence contents differ from the sealed manifest");
    return hash;
  }
}

export async function verifyPlayEvidence(root: string, expected?: string): Promise<`sha256:${string}`> {
  return new PlayEvidenceVerifier().verify(root, expected);
}

/** Copy the immutable reference package BEFORE a player process/model can run. */
export async function freezePlayReference(task: LoadedPlayTask, taskRunRoot: string): Promise<LoadedPlayTask> {
  const root = path.join(taskRunRoot, "reference", "play", task.manifest.game, `v${task.manifest.version.split(".")[0]}`);
  await mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 });
  for (const relative of task.files) {
    const input = path.resolve(task.root, relative);
    const output = path.resolve(root, relative);
    if (!input.startsWith(`${path.resolve(task.root)}${path.sep}`) || !output.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("reference package path escapes its root");
    const stat = await lstat(input);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("reference package contains a non-regular file");
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await copyFile(input, output);
  }
  const validation = await validatePlayTask(path.join(root, "task.yml"));
  if (!validation.valid || !validation.task) throw new Error(`invalid frozen Play package: ${validation.errors.join("; ")}`);
  if (validation.task.hash !== task.hash) throw new Error("reference package changed while being frozen");
  return validation.task;
}
