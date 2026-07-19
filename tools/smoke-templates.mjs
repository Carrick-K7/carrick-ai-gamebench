import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const templates = ["benchmark/starters/vite-ts"];

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

for (const relative of templates) {
  const runsRoot = path.join(repositoryRoot, "runs");
  await mkdir(runsRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(runsRoot, "template-smoke-"));
  const workspace = path.join(temporaryRoot, "workspace");
  const isolatedStore = path.join(temporaryRoot, "pnpm-store");
  try {
    await cp(path.join(repositoryRoot, relative), workspace, {
      recursive: true,
      filter: (entry) =>
        !new Set(["node_modules", "dist", ".git"]).has(path.basename(entry)),
    });
    // Use a new store so a green smoke test proves the starter can be
    // installed independently. The former --offline check could pass only
    // when the runner happened to have every optional package cached.
    await run(
      "pnpm",
      [
        "install",
        "--frozen-lockfile",
        "--store-dir",
        isolatedStore,
        "--ignore-workspace",
      ],
      workspace,
    );
    await run("pnpm", ["build"], workspace);
    console.log(`PASS  ${relative}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
