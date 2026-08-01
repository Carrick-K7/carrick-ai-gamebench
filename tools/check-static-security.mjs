import { readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const caddy = await readFile(
  path.join(repositoryRoot, "infra", "Caddyfile.example"),
  "utf8",
);
const showcase = await readFile(
  path.join(
    repositoryRoot,
    "apps",
    "site",
    "src",
    "pages",
    "showcase",
    "[id].astro",
  ),
  "utf8",
);

const requirements = [
  {
    valid:
      caddy.includes("gamebench.ai.carrick7.com") &&
      caddy.includes("play.gamebench.ai.carrick7.com"),
    message: "trusted and untrusted origins must remain separate",
  },
  {
    valid: (caddy.match(/connect-src 'none'/g) ?? []).length >= 2,
    message: "both origins must disable browser network connections by CSP",
  },
  {
    valid:
      caddy.includes("/srv/gamebench/current/site") &&
      caddy.includes("/srv/gamebench/storage"),
    message: "site releases and persistent object storage need separate roots",
  },
  {
    valid:
      caddy.includes("/objects/sha256/* /play/*") &&
      caddy.includes("max-age=31536000, immutable"),
    message: "content-addressed objects require immutable caching",
  },
  {
    valid:
      showcase.includes('sandbox="allow-scripts allow-pointer-lock"') &&
      !showcase.includes("allow-same-origin"),
    message: "generated games require a sandbox without same-origin access",
  },
  {
    valid:
      showcase.includes('src={playable.url}') &&
      showcase.includes('referrerpolicy="no-referrer"') &&
      showcase.includes('loading="eager"') &&
      !showcase.includes("data-load"),
    message: "the single-game showcase must load immediately and remain referrer-isolated",
  },
];

const errors = requirements
  .filter((requirement) => !requirement.valid)
  .map((requirement) => requirement.message);
if (errors.length > 0) {
  throw new Error(`Static security contract failed:\n${errors.join("\n")}`);
}

console.log("Verified static origin, CSP, iframe, and cache boundaries.");
