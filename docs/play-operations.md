# Build / Play operations — 0.7.0

**The software release includes no measured Play results or deployment. `bench` can spend money: obtain a separate budget approval before running a real model.**

## Local verification (no inference)

Use Node 22.22.0 and pnpm 10.33.0, with the repository's pinned Chromium:

```bash
pnpm install --frozen-lockfile
pnpm --filter @carrick/gamebench exec playwright install --with-deps chromium
pnpm build
pnpm check
pnpm cagb doctor --suite build
pnpm cagb doctor --suite play
```

The Build doctor runs real install/offline-install/build/browser checks. The Play doctor starts both fixed games, captures their native-input screenshots and checks the external Pi adapter. Adapter initialization/control queries are not model inference. Pi is separately installed/configured; it is not a Core/Evaluator dependency. The initial adapter targets exactly Pi 0.84.3 and rejects unaudited versions. If another Pi is your global default, set `PI_BIN` to a separately installed 0.84.3 executable before running the Play doctor or adapter; do not silently downgrade or rewrite the global installation.

For an isolated audited Pi installation, use `npm install --prefix <private-tools-directory> @earendil-works/pi-coding-agent@0.84.3`, then set `PI_BIN=<private-tools-directory>/node_modules/.bin/pi`. Keep that directory outside this repository; use Node 22.22.0 on `PATH` without changing the global Pi installation.

Tests use synthetic RPC peers and real reference games/Chromium. A passing fake-player test is not a measured model result. Human practice at `/play/practice/2048` and `/play/practice/minesweeper` is also unranked and cannot submit results.

## Preregister one suite

A Campaign v2 chooses `suite: "build"` **or** `suite: "play"`:

- Build: protocol `build-campaign-v1`, endpoint `["build.score"]`.
- Play: protocol `play-visual-v1`, endpoints `["play.2048.mean_score", "play.minesweeper.win_rate"]`.
- Use a new path-safe campaign/cell ID and a fresh preallocated ULID for every cell.
- Declare actual provider, model, agent version, adapter path/hash, prompt language and varied factors. The current adapter CLI applies exactly `parameters.thinking`; unsupported recorded-but-unapplied parameters are rejected.
- All session/context-file/extension/skill isolation switches in the plan are `false` (those sources are disabled).
- `release_hash` is SHA-256 of **file bytes**; plan/execution/seed commitments use Core's canonical JSON hash. Never interchange the conventions.
- Official execution requires a clean, unchanged Git commit containing the exact plan, release and adapter bytes. Configuration and the actual command must match the cell before any measured call.

For Play, generate a private bundle first:

```bash
mkdir -p "$HOME/.local/state/gamebench"
chmod 700 "$HOME/.local/state/gamebench"
pnpm cagb play seeds --output "$HOME/.local/state/gamebench/new-campaign-seeds.json"
```

This prints only the `seed_commitment` object to insert into the plan. The bundle contains ten distinct cryptographically sampled unsigned-32-bit seeds per game, in released game order. The file is mode 0600, outside the repository, and is never overwritten by regeneration. Do not select seeds using model outcomes. Keep calibration controls separate from measured experiments.

Store the plan at `benchmark/campaigns/0.7.0/<campaign-id>.json`. Review and commit the plan and implementation before invoking a real player. `pnpm cagb campaign check` validates public bindings without inference. Example cell shape (replace every placeholder; this is not a ready-to-run plan):

```json
{
  "cell_id": "first",
  "series_id": "<new ULID>",
  "agent": { "id": "pi", "version": "0.84.3" },
  "adapter": { "path": "tools/agents/pi-play.mjs", "hash": "sha256:<adapter file hash>" },
  "provider": "<provider>",
  "model": "<vision-capable model>",
  "parameters": { "thinking": "off" },
  "prompt_language": "en",
  "isolation": { "session": false, "context_files": false, "extensions": false, "skills": false }
}
```

Use `comparison.unit: "system"`, `comparability: "within-release-only"`, `order_policy: "preregistered"`, the suite's exact endpoints, and a truthful `vary` array (empty for one cell).

## Execute only after budget approval

```bash
pnpm cagb bench --suite play --campaign <campaign-id> --cell <cell-id> \
  --seed-bundle "$HOME/.local/state/gamebench/new-campaign-seeds.json"

pnpm cagb bench --suite build --campaign <build-campaign-id> --cell <cell-id>
```

Cells execute in their preregistered order. All Play cells use the same committed bundle/order. A full Play series has 20 episodes and at most 3,280 ordinary decision requests. There can be one additional identical pre-content transport retry per slot, inside that slot's original 60-second limit. The worst-case decision time alone is about 54.7 hours per series, before process/browser overhead. Actual cost depends on model/provider and is **not** equalized by this budget.

A game loss, 200/128-step exhaustion, a healthy slot timeout or three consecutive invalid answers is a measured budget outcome. Infrastructure faults are unscored. Do not rerun an aborted cell, select surviving episodes or continue after an incomplete prior cell; create a new reviewed experiment instead.

For local adapter development, `bench --local --suite play --agent-command '<absolute adapter command>'` derives/verifies the effective player identity and uses fresh uncommitted seeds unless supplied. This still invokes the configured model unless it is a synthetic fixture. Complete standalone local records can be explicitly published only as Experimental; they never become Official by declaring a profile string.

## Check, replay and disclose

```bash
pnpm cagb check --run runs/0.7.0/<series-id>
pnpm cagb replay --run runs/0.7.0/<play-series-id>
pnpm cagb replay --run runs/0.7.0/<play-series-id> --engine-only
```

Replay never calls a model or injects saved final snapshots. Default browser replay verifies native input mapping and PNG/state correspondence; engine-only replay is cheaper and checks deterministic transitions, **not visual fidelity**. The strict browser check should use the same pinned browser/font environment as capture; a cross-host raster mismatch is not a model score change.

Only after **every** Campaign cell has complete, checked coverage:

```bash
pnpm cagb campaign publish --id <campaign-id>
pnpm cagb check
```

All cells undergo raw evidence/browser checks before any public result or seed is written. The canonical flat index changes atomically. A failed check must leave the public index unchanged. Publication is a local repository operation, not permission to commit, push, tag, upload raw evidence or deploy.

The index lock is fail-closed: no existing lock is reclaimed automatically, including one naming an exited process. If a publisher crashed, first verify that no publisher is running, then an operator may remove `results/lite/index.json.lock` and retry. Never remove a live or unconfirmed lock.

## Canonical files and privacy

```text
benchmark/releases/0.7.0.json
benchmark/campaigns/0.7.0/<campaign-id>.json
runs/0.7.0/<series-id>/.series.json
runs/0.7.0/<series-id>/result.json
runs/0.7.0/<series-id>/seeds.private.json
runs/0.7.0/<series-id>/tasks/play.<game>.v1/reference/play/<game>/v1/
runs/0.7.0/<series-id>/tasks/play.<game>.v1/episodes/000/
results/lite/0.7.0/<series-id>.json
results/lite/index.json
```

Per-episode evidence contains PNGs, bounded observations, final-response audits, confirmed private states, termination and a seal. An interrupted input retains its confirmed prefix without inventing a final state. Task manifests bind nested episode manifests. There is no fake Play `source_hash`, no `play.score`, and no second `results/play` ledger.

Pi's audited system-prompt builder appends a working-directory label. The adapter therefore gives Pi a separate empty temporary cwd, never its credential directory, the repository, a reference package or a run directory; this bounded SDK boilerplate is not an additional game observation.

Keep private runs, private seeds, credentials and temporary agent settings out of Git/public hosting. Runtime auth/model copies are isolated outside the evidence tree and cleaned up; API keys never belong in model-parameter JSON. Public flat records reveal episode seeds only after campaign completion. A public hash is not an archive download: the static site offers artifact links only if artifacts were actually published separately.

Official is a maintainer-operated, auditable experiment, not OS/host attestation or proof of proprietary model weights. Ten games per endpoint are small samples; comparisons across different Campaign seed bundles are descriptive, not paired.

## 中文要点

- Build 测做游戏，Play 测截图理解、操作和有限步数下的策略；两者互不前置、不合成总分。
- 2048：10 局、每局 200 次决策，按原始分均值排名；不是“达到 2048”的通关测试。
- 扫雷：10 局、10×10/10 雷、每局 128 次决策，按胜率排名；首揭及邻域安全，但可能必须猜雷。
- 正式种子先私下生成、承诺 hash，再执行全部预注册 cell；全部完成后才能公开，不挑选好局、不把基础设施故障记零分。
- `doctor`、回放和人类练习不调用模型；真实 `bench` 必须另行批准预算。
- 0.7.0 是软件与评测协议版本发布，不包含部署或新增真实模型成绩。
