import "./style.css";
import type { CarrickGameBenchBridge } from "./bridge";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app is missing");
}

app.innerHTML = `
  <section class="starter">
    <p>CARRICK AI GAMEBENCH</p>
    <h1>Implement the assigned game</h1>
    <p>Read the prompt and replace this starter. Keep the test bridge contract.</p>
    <button id="start">Start placeholder</button>
  </section>
`;

let status: "menu" | "running" = "menu";
let tick = 0;
let seed = 0;
const events: Array<{ seq: number; type: string }> = [];

function start(): void {
  status = "running";
  events.push({ seq: events.length + 1, type: "started" });
}

document.querySelector("#start")?.addEventListener("click", start);

const bridge: CarrickGameBenchBridge = {
  version: "1",
  ready: Promise.resolve(),
  async reset(input) {
    status = "menu";
    tick = 0;
    seed = input.seed;
    events.length = 0;
  },
  async act(input) {
    if (input.type === "start") {
      start();
    }
  },
  async advance(ms) {
    tick += ms;
  },
  async snapshot() {
    return {
      status,
      tick,
      score: 0,
      state: { seed, placeholder: true },
      events: [...events],
    };
  },
};

window.__CARRICK_GAMEBENCH__ = bridge;
