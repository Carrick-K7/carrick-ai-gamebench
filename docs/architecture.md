# GameBench 0.7 architecture

## Components

```text
apps/site           static Build/Play, task, methodology and result pages
apps/reviewer       optional historical local human annotation UI
packages/core       strict contracts, hashes, scoring and qualification
packages/evaluator  cagb CLI, Build/Play runners, evidence checks and publication
benchmark/starters  fresh Build Agent workspace
benchmark/tasks     four active Build contracts
benchmark/play      two immutable reference games and separate calibration
benchmark/retired   inactive historical task packages
benchmark/releases  immutable release locks
benchmark/campaigns committed single-suite experiment plans
results/lite        one Git-reviewed flat result index for both suites
```

The pinned verification runtime is Node.js 22.22.0, pnpm 10.33.0 and Playwright
Chromium. Core/Evaluator have no model-provider SDK. There is no Docker daemon,
verifier service, database, scheduler or production application server. Pi is an
external adapter dependency, not part of the benchmark's provider-neutral core.

## Two explicit execution paths

```text
frozen release + task packages + preregistered Campaign
                            |
                   model-free preflight
                            |
             +--------------+--------------+
             |                             |
           Build                          Play
  fresh workspace per task      frozen maintainer-owned games
  one development invocation    ten fresh episodes per game
  stop process tree             bounded screenshot -> native action loop
  freeze source archive         authoritative private engine outcome
  fresh install/build/browser   sealed frames, decisions and state evidence
             |                             |
  four-task equal-weight mean   per-game metrics; no Play total
             +--------------+--------------+
                            |
               flat result + private evidence
                            |
           shared qualification + Campaign checks
                            |
                one atomic publication writer
                            |
                 static per-suite projections
```

Build reuses the unchanged task evaluator and one shared task-batch policy.
Failures are retained; development is never retried. The v3 runner constructs its
own result envelope directly, rather than manufacturing an intermediate v2
record. Play is not forced into Build's source-delivery model.

## Three identities, one ledger

- **Release** defines the frozen instrument: task/protocol hashes and budgets.
- **Campaign** defines the experiment before execution: configuration, order,
  endpoints, preallocated single-use series IDs and Play seed commitment.
- **Series result** is one flat observation, selecting exactly one suite.

Canonical paths remain `runs/<version>/<series-id>/` for private evidence and
`results/lite/<version>/<series-id>.json` for public records. A series directory
is created exclusively and is never reused. The index is the sole publication
ledger; neither Campaign nor Play introduces another one.

ReleaseLock v4, Campaign v2 and flat result v3 are new protocol generations.
Historical decoders, hashes, results and URLs keep their meaning. Dispatch occurs
at the record boundary. Current Build pages project actual flat task results,
not synthetic Submission/Evaluation/Publication entities or empty Core/Reproduce
fields. Historical pages retain their own adapters.

## Failure and trust boundary

Preflight succeeds before measured calls. Contract failures and bounded player
outcomes can score zero; host, browser, reference-engine and unrecovered provider
service defects produce unscored/incomplete measurements, not model zeroes.
Build infrastructure retries reuse the identical source archive. Play permits
only one identical-request transport retry before model content and within the
original decision deadline; episodes are never silently resampled.

The runner owns the Play engine. The browser gets a positively constructed public
projection; the player gets only screenshot, rules and bounded action/memo memory.
The private seed and hidden state are not player tools. Engine replay recomputes
state/score; native-browser replay additionally verifies real input mapping and
rendered frames. These are distinct checks, not two competing score authorities.

Agent, install, build, preview and browser lifecycles are bounded and closed.
Evaluator-owned commands use a credential-free allowlisted environment. The
trusted external player adapter alone accesses provider credentials. Fresh
contexts and hashes are not OS isolation or proof of proprietary model weights:
Official remains maintainer-operated and auditable, not trustless.

## Validation and publication

Core owns per-result qualification and a shared Campaign commit-consistency rule.
Every Campaign cell must use the same clean recorded Git commit, release and
plan; individual clean commits do not satisfy the cross-cell requirement.

Raw Build checks verify frozen archives, evidence manifests and score arithmetic
without re-evaluating source. Play checks also perform deterministic replay.
Within one Play check, a filesystem-stamped hash cache avoids rereading unchanged
frame bytes at every nested seal. Each seal still checks directory membership,
file types, manifest bytes and identity; changed files are rehashed. Independent
checks start with an empty cache and cannot request a trust-bypassing shortcut.

All result generations publish through one checked-snapshot writer: acquire the
index lock, reread the index, reject indexed identities, write exclusive files,
then atomically rename the updated index. Interrupted unindexed files may be
reused only when their bytes exactly equal the checked snapshot; conflicting
files are never silently overwritten. Campaign publication checks every cell
before touching public paths or disclosing seeds. No publication step calls a
model, regrades Build source, or deploys a service.
