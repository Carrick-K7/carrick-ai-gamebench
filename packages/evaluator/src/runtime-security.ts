import type { BrowserContext } from "@playwright/test";

const IN_DOCUMENT_PROTOCOLS = new Set(["about:", "blob:", "data:"]);

export function isAllowedRuntimeUrl(baseUrl: string, candidate: string): boolean {
  const target = new URL(candidate);
  if (IN_DOCUMENT_PROTOCOLS.has(target.protocol)) {
    return true;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return false;
  }
  return target.origin === new URL(baseUrl).origin;
}

export async function installRuntimeNetworkGuard(
  context: BrowserContext,
  baseUrl: string,
): Promise<void> {
  await context.route("**/*", async (route) => {
    if (isAllowedRuntimeUrl(baseUrl, route.request().url())) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
  await context.routeWebSocket("**/*", async (webSocket) => {
    await webSocket.close({
      code: 1008,
      reason: "GameBench runtime network policy blocks WebSockets",
    });
  });
}
