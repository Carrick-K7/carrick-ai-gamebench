import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import {
  access,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import {
  listTasks,
  RunManifestSchema,
  ScoreResultSchema,
  type RunManifest,
} from "@carrick/gamebench-core";

interface ReviewCandidate {
  task_id: string;
  task_version: string;
  prompt_language: string;
  artifact_hash: string;
  preview_url: string;
  reference_url?: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findNamedFiles(
  root: string,
  name: string,
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (
          new Set(["node_modules", ".git", "dist", "playwright"]).has(
            entry.name,
          )
        ) {
          return [];
        }
        return findNamedFiles(absolute, name);
      }
      return entry.isFile() && entry.name === name ? [absolute] : [];
    }),
  );
  return nested.flat();
}

async function collectCandidates(
  repositoryRoot: string,
  runsRoot: string,
): Promise<{
  candidates: ReviewCandidate[];
  candidateRoots: Map<string, string>;
  referenceRoots: Map<string, string>;
}> {
  const tasks = await listTasks(repositoryRoot);
  const tasksById = new Map(tasks.map((task) => [task.manifest.id, task]));
  const candidateRoots = new Map<string, string>();
  const referenceRoots = new Map<string, string>();
  const candidates: ReviewCandidate[] = [];

  for (const runPath of await findNamedFiles(runsRoot, "run.json")) {
    const runDir = path.dirname(runPath);
    const scorePath = path.join(runDir, "score.json");
    const digestPath = path.join(runDir, "source.sha256");
    if (!(await exists(scorePath)) || !(await exists(digestPath))) {
      continue;
    }
    const runResult = RunManifestSchema.safeParse(
      JSON.parse(await readFile(runPath, "utf8")),
    );
    const scoreResult = ScoreResultSchema.safeParse(
      JSON.parse(await readFile(scorePath, "utf8")),
    );
    if (!runResult.success || !scoreResult.success) {
      continue;
    }
    const run: RunManifest = runResult.data;
    if (scoreResult.data.task_id !== run.task_id) {
      continue;
    }
    const digest = (await readFile(digestPath, "utf8")).split(/\s+/)[0];
    const task = tasksById.get(run.task_id);
    if (!digest || !/^[a-f0-9]{64}$/.test(digest) || !task) {
      continue;
    }
    const candidateId = createHash("sha256")
      .update(`${run.run_id}\0${digest}`)
      .digest("hex")
      .slice(0, 24);
    const workspace = path.join(runDir, "workspace");
    const previewRoot = (await exists(path.join(workspace, "dist")))
      ? path.join(workspace, "dist")
      : workspace;
    candidateRoots.set(candidateId, previewRoot);
    if (task.manifest.reference) {
      referenceRoots.set(task.manifest.id, task.root);
    }
    candidates.push({
      task_id: run.task_id,
      task_version: task.manifest.version,
      prompt_language: run.prompt_language,
      artifact_hash: `sha256:${digest}`,
      preview_url: `/candidate/${candidateId}/`,
      ...(task.manifest.reference
        ? {
            reference_url: `/reference/${encodeURIComponent(
              task.manifest.id,
            )}/${task.manifest.reference.capture_pack}`,
          }
        : {}),
    });
  }
  return { candidates, candidateRoots, referenceRoots };
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".yml": "text/yaml; charset=utf-8",
};

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function serveFile(
  response: ServerResponse,
  root: string,
  relative: string,
  fallbackToIndex = false,
): Promise<void> {
  let normalized = decodeURIComponent(relative).replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/")) {
    normalized += "index.html";
  }
  let filePath = path.resolve(root, normalized);
  if (!filePath.startsWith(`${path.resolve(root)}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (!(await exists(filePath)) && fallbackToIndex) {
    filePath = path.join(root, "index.html");
  }
  if (!(await exists(filePath)) || !(await stat(filePath)).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
}

export async function serveReviewer(options: {
  repositoryRoot: string;
  benchmarkVersion: string;
  runsRoot: string;
  port: number;
}): Promise<void> {
  const data = await collectCandidates(
    options.repositoryRoot,
    options.runsRoot,
  );
  const reviewerRoot = path.join(
    options.repositoryRoot,
    "apps",
    "reviewer",
    "dist",
  );
  if (!(await exists(path.join(reviewerRoot, "index.html")))) {
    throw new Error("Reviewer is not built. Run `pnpm build` first.");
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "127.0.0.1"}`,
      );
      if (url.pathname === "/api/review") {
        sendJson(response, {
          schema_version: 1,
          benchmark_version: options.benchmarkVersion,
          candidates: data.candidates,
        });
        return;
      }
      const candidateMatch = /^\/candidate\/([^/]+)\/?(.*)$/.exec(url.pathname);
      if (candidateMatch?.[1] !== undefined) {
        const runId = decodeURIComponent(candidateMatch[1]);
        const root = data.candidateRoots.get(runId);
        if (!root) {
          response.writeHead(404).end("Unknown candidate");
          return;
        }
        await serveFile(response, root, candidateMatch[2] ?? "", true);
        return;
      }
      const referenceMatch = /^\/reference\/([^/]+)\/?(.*)$/.exec(url.pathname);
      if (referenceMatch?.[1] !== undefined) {
        const taskId = decodeURIComponent(referenceMatch[1]);
        const root = data.referenceRoots.get(taskId);
        if (!root) {
          response.writeHead(404).end("Unknown reference");
          return;
        }
        await serveFile(response, root, referenceMatch[2] ?? "");
        return;
      }
      await serveFile(response, reviewerRoot, url.pathname, true);
    })().catch((error) => {
      response.writeHead(500).end(
        error instanceof Error ? error.message : String(error),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  console.log(`CAGB reviewer: http://127.0.0.1:${options.port}`);
  console.log(`Loaded ${data.candidates.length} candidates from ${options.runsRoot}`);
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
