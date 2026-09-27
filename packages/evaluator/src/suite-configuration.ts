import { assertSecretFreePublication } from "./lite-runner.js";

/** Apply before recording configuration as evidence, not just before publication. */
export function assertSecretFreeSuiteConfiguration(value: unknown): void {
  assertSecretFreePublication(value);
  function visit(item: unknown): void {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    for (const [key, nested] of Object.entries(item)) {
      const normalized = key.replaceAll(/[^a-z]/gi, "").toLowerCase();
      if (/api.?key|access.?key|secret|password|authorization|credential|bearer|private.?key/i.test(key) || ["token", "accesstoken", "refreshtoken", "authtoken", "idtoken"].includes(normalized)) throw new Error("measurement configuration may not contain credential fields");
      visit(nested);
    }
  }
  visit(value);
}
