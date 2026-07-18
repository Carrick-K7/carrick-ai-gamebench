import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

export async function writeJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") {
          return [];
        }
        return collectFiles(root, absolute);
      }
      if (entry.isFile() && entry.name !== "MANIFEST.sha256") {
        return [path.relative(root, absolute)];
      }
      return [];
    }),
  );
  return nested.flat().sort();
}

export async function writeEvidenceManifest(root: string): Promise<string> {
  const files = await collectFiles(root);
  const lines = await Promise.all(
    files.map(async (relative) => {
      const digest = await sha256File(path.join(root, relative));
      return `${digest}  ${relative.split(path.sep).join("/")}`;
    }),
  );
  const output = `${lines.join("\n")}\n`;
  await writeFile(path.join(root, "MANIFEST.sha256"), output, "utf8");
  return output;
}

export async function verifyEvidenceManifest(
  root: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const listedFiles = new Set<string>();
  const manifestPath = path.join(root, "MANIFEST.sha256");
  const lines = (await readFile(manifestPath, "utf8"))
    .split("\n")
    .filter(Boolean);

  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match?.[1] || !match[2]) {
      errors.push(`malformed manifest line: ${line}`);
      continue;
    }
    const relative = match[2];
    if (listedFiles.has(relative)) {
      errors.push(`duplicate manifest entry: ${relative}`);
      continue;
    }
    listedFiles.add(relative);
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      errors.push(`manifest path escapes run directory: ${relative}`);
      continue;
    }
    try {
      const actual = await sha256File(absolute);
      if (actual !== match[1]) {
        errors.push(`digest mismatch: ${relative}`);
      }
    } catch {
      errors.push(`missing artifact: ${relative}`);
    }
  }

  for (const relative of await collectFiles(root)) {
    const normalized = relative.split(path.sep).join("/");
    if (!listedFiles.has(normalized)) {
      errors.push(`unlisted artifact: ${normalized}`);
    }
  }

  if (
    listedFiles.has("source.sha256") ||
    listedFiles.has("source.tar.zst")
  ) {
    try {
      const checksum = (
        await readFile(path.join(root, "source.sha256"), "utf8")
      ).trim();
      const match = /^([a-f0-9]{64})  source\.tar\.zst$/.exec(checksum);
      if (!match?.[1]) {
        errors.push("malformed source.sha256");
      } else {
        const actual = await sha256File(path.join(root, "source.tar.zst"));
        if (actual !== match[1]) {
          errors.push("source archive digest mismatch");
        }
      }
    } catch {
      errors.push("source archive checksum pair is incomplete");
    }
  }

  return { valid: errors.length === 0, errors };
}
