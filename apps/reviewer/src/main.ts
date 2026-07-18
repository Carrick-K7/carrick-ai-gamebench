import "./style.css";

interface Candidate {
  task_id: string;
  task_version: string;
  prompt_language: "en" | "zh";
  artifact_hash: string;
  preview_url: string;
  reference_url?: string;
}

interface ReviewData {
  schema_version: 1;
  benchmark_version: string;
  candidates: Candidate[];
}

interface Pair {
  key: string;
  taskId: string;
  taskVersion: string;
  language: "en" | "zh";
  a: Candidate;
  b: Candidate;
  leftCandidate: "a" | "b";
  referenceUrl?: string;
}

interface Vote {
  schema_version: 1;
  benchmark_version: string;
  task_id: string;
  task_version: string;
  prompt_language: "en" | "zh";
  reviewer_id: string;
  session_id: string;
  candidate_a_hash: string;
  candidate_b_hash: string;
  left_candidate: "a" | "b";
  choice: "a" | "b" | "tie" | "both-bad";
  tags: string[];
  created_at: string;
}

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) {
  throw new Error("#app is missing");
}
const app = appElement;

const reviewerId =
  localStorage.getItem("cagb-reviewer-id") ?? crypto.randomUUID();
localStorage.setItem("cagb-reviewer-id", reviewerId);
const sessionId = crypto.randomUUID();
const votes: Vote[] = [];
const tags = ["controls", "playability", "correctness", "visual", "polish"];
let data: ReviewData;
let pairs: Pair[] = [];
let pairIndex = 0;

function buildPairs(candidates: Candidate[]): Pair[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = [
      candidate.task_id,
      candidate.task_version,
      candidate.prompt_language,
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const result: Pair[] = [];
  for (const [groupKey, group] of groups) {
    const sorted = [...group].sort((left, right) =>
      left.artifact_hash.localeCompare(right.artifact_hash),
    );
    for (let left = 0; left < sorted.length; left += 1) {
      for (let right = left + 1; right < sorted.length; right += 1) {
        const a = sorted[left];
        const b = sorted[right];
        if (!a || !b || a.artifact_hash === b.artifact_hash) {
          continue;
        }
        result.push({
          key: `${groupKey}|${a.artifact_hash}|${b.artifact_hash}`,
          taskId: a.task_id,
          taskVersion: a.task_version,
          language: a.prompt_language,
          a,
          b,
          leftCandidate: Math.random() < 0.5 ? "a" : "b",
          ...(a.reference_url ? { referenceUrl: a.reference_url } : {}),
        });
      }
    }
  }
  return result.sort(() => Math.random() - 0.5);
}

function candidateForSide(pair: Pair, side: "left" | "right"): Candidate {
  const left = pair.leftCandidate === "a" ? pair.a : pair.b;
  const right = pair.leftCandidate === "a" ? pair.b : pair.a;
  return side === "left" ? left : right;
}

function renderComplete(): void {
  app.innerHTML = `
    <main class="complete">
      <p class="eyebrow">CARRICK AI GAMEBENCH</p>
      <h1>Review set complete</h1>
      <p>${votes.length} blinded votes are ready to export.</p>
      <button id="export" class="primary">Export JSONL</button>
    </main>
  `;
  document.querySelector("#export")?.addEventListener("click", exportVotes);
}

function render(): void {
  const pair = pairs[pairIndex];
  if (!pair) {
    renderComplete();
    return;
  }
  const left = candidateForSide(pair, "left");
  const right = candidateForSide(pair, "right");
  const reference = pair.referenceUrl
    ? `<details class="reference">
        <summary>Reference material</summary>
        <iframe title="Reference material" src="${pair.referenceUrl}" sandbox="allow-scripts"></iframe>
      </details>`
    : "";

  app.innerHTML = `
    <header>
      <div>
        <p class="eyebrow">CARRICK AI GAMEBENCH · BLIND PLAYTEST</p>
        <h1>${pair.taskId}</h1>
      </div>
      <div class="progress">${pairIndex + 1} / ${pairs.length}</div>
    </header>
    ${reference}
    <main class="arena">
      <section class="candidate">
        <div class="candidate-label">GAME A</div>
        <iframe title="Game A" src="${left.preview_url}" sandbox="allow-scripts allow-pointer-lock"></iframe>
      </section>
      <section class="candidate">
        <div class="candidate-label">GAME B</div>
        <iframe title="Game B" src="${right.preview_url}" sandbox="allow-scripts allow-pointer-lock"></iframe>
      </section>
    </main>
    <section class="decision">
      <div class="tags">
        <span>Reason tags</span>
        ${tags
          .map(
            (tag) =>
              `<label><input type="checkbox" name="tag" value="${tag}" /> ${tag}</label>`,
          )
          .join("")}
      </div>
      <div class="choices">
        <button data-choice="left">A is better</button>
        <button data-choice="right">B is better</button>
        <button data-choice="tie">Tie</button>
        <button data-choice="both-bad">Both are bad</button>
      </div>
      <p class="hint">Judge the playable result: correctness, controls, feel, fidelity, and polish. Model identity and machine score remain hidden.</p>
    </section>
  `;

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-choice]")) {
    button.addEventListener("click", () => {
      const rawChoice = button.dataset.choice;
      if (!rawChoice) {
        return;
      }
      const selectedTags = [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[name="tag"]:checked',
        ),
      ].map((input) => input.value);
      let choice: Vote["choice"];
      if (rawChoice === "left") {
        choice = pair.leftCandidate;
      } else if (rawChoice === "right") {
        choice = pair.leftCandidate === "a" ? "b" : "a";
      } else {
        choice = rawChoice as "tie" | "both-bad";
      }
      votes.push({
        schema_version: 1,
        benchmark_version: data.benchmark_version,
        task_id: pair.taskId,
        task_version: pair.taskVersion,
        prompt_language: pair.language,
        reviewer_id: reviewerId,
        session_id: sessionId,
        candidate_a_hash: pair.a.artifact_hash,
        candidate_b_hash: pair.b.artifact_hash,
        left_candidate: pair.leftCandidate,
        choice,
        tags: selectedTags,
        created_at: new Date().toISOString(),
      });
      pairIndex += 1;
      render();
    });
  }
}

function exportVotes(): void {
  const contents = `${votes.map((vote) => JSON.stringify(vote)).join("\n")}\n`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([contents], { type: "application/x-ndjson" }),
  );
  link.download = `cagb-votes-${sessionId}.jsonl`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialize(): Promise<void> {
  const response = await fetch("/api/review");
  if (!response.ok) {
    throw new Error(`Could not load review data: HTTP ${response.status}`);
  }
  data = (await response.json()) as ReviewData;
  pairs = buildPairs(data.candidates);
  if (pairs.length === 0) {
    app.innerHTML = `
      <main class="complete">
        <p class="eyebrow">CARRICK AI GAMEBENCH</p>
        <h1>No comparable candidates</h1>
        <p>Add at least two completed runs for the same task, version, and prompt language.</p>
      </main>
    `;
    return;
  }
  render();
}

initialize().catch((error) => {
  app.innerHTML = `<main class="complete"><h1>Reviewer failed</h1><pre>${String(error)}</pre></main>`;
});
