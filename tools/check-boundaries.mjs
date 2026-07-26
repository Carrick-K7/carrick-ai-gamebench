import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

async function sourceFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(absolute));
    } else if (/\.(?:astro|[cm]?[jt]sx?)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function importedPackages(source) {
  const packages = [];
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    packages.push(match[1]);
  }
  return packages;
}

const rules = [
  {
    root: "apps/site/src",
    forbiddenPackages: [
      "@carrick/gamebench",
      "@carrick/gamebench-publisher",
    ],
    forbiddenSource: [
      { pattern: /\bruns\//, message: "site source must not read private runs" },
      { pattern: /\btrajectory\b/i, message: "site source must not read trajectories" },
      { pattern: /\bprovider[_ -]?response\b/i, message: "site source must not read provider responses" },
      { pattern: /\b(?:OPENAI|ANTHROPIC|DEEPSEEK|KIMI|MOONSHOT)_API_KEY\b/, message: "site source must not require model credentials" },
    ],
  },
  {
    root: "packages/core/src",
    forbiddenPackages: [
      "@carrick/gamebench",
      "@carrick/gamebench-publisher",
      "@carrick/gamebench-site",
    ],
    forbiddenSource: [],
  },
  {
    root: "packages/publisher/src",
    forbiddenPackages: [
      "@carrick/gamebench",
      "@carrick/gamebench-site",
    ],
    forbiddenSource: [],
  },
];

const errors = [];
for (const rule of rules) {
  const root = path.join(repositoryRoot, rule.root);
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, "utf8");
    for (const imported of importedPackages(source)) {
      if (
        rule.forbiddenPackages.some(
          (name) => imported === name || imported.startsWith(`${name}/`),
        )
      ) {
        errors.push(
          `${path.relative(repositoryRoot, file)} imports forbidden package ${imported}`,
        );
      }
    }
    for (const check of rule.forbiddenSource) {
      if (check.pattern.test(source)) {
        errors.push(`${path.relative(repositoryRoot, file)}: ${check.message}`);
      }
    }
  }
}

const sitePackage = JSON.parse(
  await readFile(path.join(repositoryRoot, "apps/site/package.json"), "utf8"),
);
const siteWorkspaceDependencies = Object.keys(sitePackage.dependencies ?? {})
  .filter((name) => name.startsWith("@carrick/"));
if (
  siteWorkspaceDependencies.length !== 1 ||
  siteWorkspaceDependencies[0] !== "@carrick/gamebench-core"
) {
  errors.push(
    "apps/site may depend only on @carrick/gamebench-core from this workspace",
  );
}

if (errors.length > 0) {
  throw new Error(`Repository boundary violations:\n${errors.join("\n")}`);
}

console.log("Verified public-site and package dependency boundaries.");
