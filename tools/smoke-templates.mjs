import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
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
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cagb-template-"));
  const workspace = path.join(temporaryRoot, "workspace");
  try {
    await cp(path.join(repositoryRoot, relative), workspace, {
      recursive: true,
      filter: (entry) =>
        !new Set(["node_modules", "dist", ".git"]).has(path.basename(entry)),
    });
    await run("pnpm", ["install", "--frozen-lockfile", "--offline"], workspace);
    await run("pnpm", ["build"], workspace);
    console.log(`PASS  ${relative}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
