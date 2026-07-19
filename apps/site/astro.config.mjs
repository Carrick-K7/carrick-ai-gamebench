import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: process.env.GAMEBENCH_SITE_URL ?? "https://gamebench.ai.carrick7.com",
});
