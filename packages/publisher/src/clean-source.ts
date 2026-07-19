import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT_FILES = [
  /^index\.html$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^state\.schema\.json$/,
  /^tsconfig(?:\.[a-zA-Z0-9_-]+)?\.json$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^README(?:\.[a-zA-Z0-9_-]+)?(?:\.md)?$/,
  /^(?:LICENSE|NOTICE)(?:\.[a-zA-Z0-9_-]+)?$/,
];
const ROOT_DIRECTORIES = new Set(["src", "public", "assets"]);
const FORBIDDEN_NAME = /(?:^|[._-])(trajectory|credential|secret|token|private-key)(?:[._-]|$)/i;
const TEXT_EXTENSION = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:OPENAI|ANTHROPIC|GOOGLE|DEEPSEEK|KIMI|MOONSHOT)_API_KEY\s*[:=]\s*["']?[^\s"']{8,}/i,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/,
];

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function rejectName(name: string): void {
  if (
    name === ".git" ||
    name === "node_modules" ||
    name === "dist" ||
    name === ".cache" ||
    name === ".npmrc" ||
    name === ".pnpmrc" ||
    name.startsWith(".env") ||
    name.endsWith(".log") ||
    FORBIDDEN_NAME.test(name)
  ) {
    throw new Error(`public source contains a forbidden path: ${name}`);
  }
}

async function scanAndCopyDirectory(
  sourceRoot: string,
  destinationRoot: string,
  current = sourceRoot,
): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    rejectName(entry.name);
    const absolute = path.join(current, entry.name);
    const relative = path.relative(sourceRoot, absolute);
    const destination = path.join(destinationRoot, relative);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new Error(`public source contains a symlink: ${relative}`);
    }
    if (info.isDirectory()) {
      await mkdir(destination, { recursive: true });
      await scanAndCopyDirectory(sourceRoot, destinationRoot, absolute);
    } else if (info.isFile()) {
      if (
        info.size <= 1_000_000 &&
        TEXT_EXTENSION.has(path.extname(entry.name).toLowerCase())
      ) {
        const text = await readFile(absolute, "utf8");
        if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
          throw new Error(`public source secret scan failed: ${relative}`);
        }
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(absolute, destination);
    }
  }
}

export async function exportCleanSource(
  workspace: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(workspace, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isFile() &&
      ROOT_FILES.some((pattern) => pattern.test(entry.name))
    ) {
      rejectName(entry.name);
      await copyFile(
        path.join(workspace, entry.name),
        path.join(destination, entry.name),
      );
    } else if (entry.isDirectory() && ROOT_DIRECTORIES.has(entry.name)) {
      await scanAndCopyDirectory(
        path.join(workspace, entry.name),
        path.join(destination, entry.name),
      );
    }
  }
  if (!(await exists(path.join(destination, "package.json")))) {
    throw new Error("clean source export requires package.json");
  }
}

async function runTar(source: string, output: string): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "tar",
      [
        "--zstd",
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--pax-option=delete=atime,delete=ctime",
        "-cf",
        output,
        "-C",
        source,
        ".",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

export async function preparePublicArtifacts(
  workspace: string,
  outputRoot: string,
  options: { replacePlayable?: boolean } = {},
): Promise<{ sourceArchive: string; playable: string }> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-public-source-"));
  const cleanSource = path.join(temporary, "source");
  try {
    await exportCleanSource(workspace, cleanSource);
    const sourceArchive = path.join(outputRoot, "clean-source.tar.zst");
    await runTar(cleanSource, sourceArchive);
    const dist = path.join(workspace, "dist");
    if (!(await exists(path.join(dist, "index.html")))) {
      throw new Error("playable publication requires workspace/dist/index.html");
    }
    const playable = path.join(outputRoot, "playable");
    if (options.replacePlayable) {
      await rm(playable, { recursive: true, force: true });
    }
    if (!(await exists(playable))) {
      await cp(dist, playable, { recursive: true, errorOnExist: true });
    }
    const playableIndex = path.join(playable, "index.html");
    const html = await readFile(playableIndex, "utf8");
    const rebased = html.replace(
      /\b(src|href)=(["'])\/(?!\/)/g,
      (_match, attribute: string, quote: string) =>
        `${attribute}=${quote}./`,
    );
    await writeFile(playableIndex, rebased, "utf8");
    return { sourceArchive, playable };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
