---
name: simao-audit-pipeline
description: Use when performing an accounting-first smart contract security audit in the style of 0xSimao. Maps the protocol's money model first — assets, tracked totals, the asymmetry table, invariants, lifecycles, and actor cohorts — then attacks it with 12 parallel single-specialty lenses reverse-engineered from 0xSimao's 869 published findings (177 High, 247 Medium across 143 reviews). Its signature class: a tracked total that desyncs from reality, letting early actors over-withdraw and leaving the last user out insolvent. Produces deduplicated, gated, severity-classified findings with PoCs for High findings. Trigger on "simao audit", "0xsimao audit", "accounting-first audit", "follow the money audit".
---

# 0xSimao Audit Pipeline

You are the orchestrator of an accounting-first, parallelized smart contract security audit.

The method is reverse-engineered from 0xSimao's 869 published findings (177 High, 247 Medium) across 143 reviews. His signature is not a checklist. It is this: **build the protocol's accounting model first, then find the one step in a multi-step sequence where a tracked total desyncs from reality — and prove who is left holding the loss.**

Roughly a third of his Highs are one shape: *value leaves the contract but the variable tracking it is never decremented (or is decremented in only one of two branches)*, so early actors over-withdraw and the last actor out is insolvent. The twelve lenses are built around that class and its siblings.

Vendored from 0xSimao's open-source skill (`github.com/0xsimao/0xsimao-ai`), **VERSION 1.0.0** (see the `VERSION` file alongside this one). Everything under `references/` is upstream content carried over intact, save one repo-convention normalization — `on-chain` → `onchain` — required by this repo's style rule. The EVM Cortex adaptations (agent mapping, Foundry pre-flight, PoC routing) live in this `SKILL.md` only, so an upstream re-sync replaces `references/` cleanly. Check for a newer upstream revision before a high-stakes audit:

```bash
curl -sf https://raw.githubusercontent.com/0xsimao/0xsimao-ai/main/VERSION
```

If that returns a version greater than `1.0.0`, this skill is behind upstream.

## The stance: build the money map, then attack it

This is what separates a 0xSimao audit from a generic parallel scan. Most audit tooling scans for bad lines — that finds what a linter finds. This pipeline writes the protocol's accounting model down first, then hunts the gap between what the protocol *records* and what it *holds*. Three consequences worth stating up front:

- **The money map is a prerequisite, not a filter.** The largest class of bug lives in the *relationships between* tracked totals, not in single lines, and no lens can see those relationships without the map. A lens that also finds a bricked liquidation, a signature defect, or a token-compatibility break still reports it — the map is the starting point, not the boundary.
- **A finding is not real until traced with concrete numbers and a named victim.** No balance sheet, no attack path with real values → LEAD, not FINDING. Leads are honest calibration, not failures. Emit them.
- **The closing tests are mandatory.** Every lens runs the Last User Out test on each lifecycle, and the saturation sweep once it finds one bug — mine every sibling site of the same shape. A repeat instance missed is an audit failure.

### When to Use

- Accounting-heavy protocols: vaults, lending, staking, yield, AMMs, bridges, anything with tracked totals and pro-rata distribution
- Full security audit before mainnet, or re-audit after core accounting changes
- Alongside `pashov-audit-pipeline` — the two pipelines are independent and their overlap is signal; disagreement is where to look hardest

### When NOT to Use

- Quick sanity check on a single function — use `audit-breadth-scan`
- Static analysis triage — use `slither-analysis` or `aderyn-analysis`
- Gas-only review — use `gas-optimizer`
- Pre-audit reconnaissance and readiness assessment — run `xray-pre-audit` first, then feed its output in as the context package

---

## Mode Selection

**Exclude pattern:** skip directories `interfaces/`, `lib/`, `mocks/`, `test/`, `script/` and files matching `*.t.sol`, `*.s.sol`, `*Test*.sol`, `*Mock*.sol`.

- **Default** (no arguments): scan all `.sol` files using the exclude pattern. Use Bash `find`, not Glob — the exclusion logic is easier to audit and reproduce as one command.
- **`$filename ...`**: scan the specified file(s) only.

If the repo has a README, protocol docs, or a `*.md` spec in scope, add them to the find results. The accounting model comes from docs plus code, and a documented invariant the code violates is his highest-yield finding source.

**Flags:**

- `--file-output` (off by default): also write the report to `{project-name}-simao-audit-report-{timestamp}.md` in the current working directory, where `{project-name}` is the repo-root basename and `{timestamp}` is `YYYYMMDD-HHMMSS` at scan time. (The vendored `references/report-formatting.md` defines the report *content*, not its path — the path lives here.) Never write a report file unless explicitly passed.

---

## Orchestration

### Turn 1 — Discover

Print the banner, then make these tool calls in parallel in one message:

1. Bash `find` for in-scope `.sol` files (plus in-scope docs) per mode selection
2. `ToolSearch select:Agent`
3. Read the local `VERSION` file in this skill's directory
4. Bash `curl -sf https://raw.githubusercontent.com/0xsimao/0xsimao-ai/main/VERSION`
5. Bash `mktemp -d ./.audit-simao-XXXXXX` → store as `{bundle_dir}`

`{resolved_path}` is this skill's `references/` directory.

If the remote VERSION fetch succeeds and differs from local, print: `⚠️ Upstream 0xsimao-ai is at version N, this skill is vendored at 1.0.0. See https://github.com/0xsimao/0xsimao-ai`. If the fetch fails, skip silently — a network failure is not an audit finding.

### Turn 1b — Model selection

Ask which model tier the twelve lenses should run at, via `AskUserQuestion`, defaulting to the orchestrator's own family. Store as `{agent_model}`.

Prefer opus for the money-map lenses and the gap hunter (lenses 1, 2, 3, 4, 5, 12 in the mapping table below). Cross-total and cross-lens reasoning is where model tier matters most — a weaker lens on `accounting-desync` or `flow-completeness` collapses into single-line scanning, which is exactly the failure mode this method exists to beat.

### Turn 2 — Build the money map (DO NOT SKIP)

This turn is what makes the audit 0xSimao's rather than a generic parallel scan. Read `{resolved_path}/simao-method.md`, `{resolved_path}/report-formatting.md`, and `{resolved_path}/severity-calibration.md` in parallel.

Then read the in-scope source yourself and write `{bundle_dir}/money-map.md` containing, per `simao-method.md` phases 1–4:

1. **Assets** — every token/ETH that enters or leaves, and by which functions.
2. **Tracked totals** — every storage variable claiming to represent an aggregate (`total*`, `*Balance`, `*Supply`, `*Deposited`, `*Locked`, `*Accrued`, `*Reserve`, `*Debt`, accumulators, indices). For each: **every** function that writes it, and whether the write is a `+` or `-`.
3. **The asymmetry table** — for each tracked total, any function that moves the underlying value in one direction WITHOUT a matching write, or writes it in one branch of an `if` but not the sibling. This table alone produces his most common High. Flag every place a live balance read (`token.balanceOf(address(this))`, `address(this).balance`) is used as an accounting source — that is a donation attack or cross-user theft waiting to happen.
4. **Invariants** — 5–15 statements that must always hold, concretely: `Σ(user withdrawable) <= actual balance`, `totalX == Σ userX`, `every credited unit is debited exactly once`, `index only increases`. Pull from docs where docs exist; derive from code otherwise.
5. **Lifecycles** — the canonical multi-step sequences (deposit → accrue → borrow → liquidate → withdraw; stake → reward → unstake; open → adjust → close; source-chain send → dest-chain receive). Name every state variable each step touches.
6. **Cohorts** — the distinct actor classes (first depositor, late depositor, last withdrawer, borrower, liquidator, LP, delegate, operator, relayer) and what each is owed.

Keep it under ~200 lines. It goes into every lens bundle. Print a 5-line summary; do not print the whole file.

If the target has little accounting to map — a router, a registry, a verifier, a signature scheme — do not pad the map. Write the short honest version (assets, trust boundaries, actors, invariants), say in one line which sections are empty and why, and let the lenses go straight to their own specialties. Do not force a finding into the drift frame to make it sound like his.

### Turn 2b — Context package

Every lens also gets, when available: the protocol README, known issues (to avoid duplicate reports), documented design decisions, deployment context (target chains, upgrade strategy), external dependencies, and prior audit reports with resolution status.

If `xray-pre-audit` has been run, its `x-ray/x-ray.md` output is the best available context package — its threat model and cross-linked `invariants.md` seed the money map directly. Fold its invariant IDs into the invariants section of `money-map.md`.

### Turn 2c — Pre-flight

```bash
forge build --deny-warnings           # must compile clean
forge test --summary                  # establish a baseline
slither . --filter-paths "test|script|node_modules" --json slither-report.json
forge tree > dependency-tree.txt
```

If the project is not a Foundry repo, skip the pre-flight and note it — the lenses read source, not compiled artifacts, so the audit proceeds. But a clean build materially improves later PoC construction, so prefer it when the toolchain is present.

### Turn 3 — Bundle

Build all bundles in a single Bash command using `cat` (not shell variables or heredocs):

1. `{bundle_dir}/source.md` — ALL in-scope `.sol` files (plus in-scope docs), each under a `### path` header inside a fenced code block.
2. One bundle per lens = `source.md` + `money-map.md` + method + that lens + shared rules.

`source.md` and `money-map.md` live in `{bundle_dir}`; every other file below is relative to `{resolved_path}`.

| Bundle | Concatenated files, in order |
| --- | --- |
| `lens-1-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/accounting-desync.md` + `attack-lenses/shared-rules.md` |
| `lens-2-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/share-exchange-rate.md` + `attack-lenses/shared-rules.md` |
| `lens-3-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/temporal-cohort.md` + `attack-lenses/shared-rules.md` |
| `lens-4-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/liquidation-solvency.md` + `attack-lenses/shared-rules.md` |
| `lens-5-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/cross-chain-state.md` + `attack-lenses/shared-rules.md` |
| `lens-6-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/rounding-precision.md` + `attack-lenses/shared-rules.md` |
| `lens-7-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/ordering-mev.md` + `attack-lenses/shared-rules.md` |
| `lens-8-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/dos-griefing.md` + `attack-lenses/shared-rules.md` |
| `lens-9-bundle.md`  | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/access-trust.md` + `attack-lenses/shared-rules.md` |
| `lens-10-bundle.md` | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/integration-assumptions.md` + `attack-lenses/shared-rules.md` |
| `lens-11-bundle.md` | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/edge-states.md` + `attack-lenses/shared-rules.md` |
| `lens-12-bundle.md` | `source.md` + `money-map.md` + `simao-method.md` + `attack-lenses/flow-completeness.md` + `attack-lenses/shared-rules.md` |

Print line counts for `source.md` and every bundle. An undersized bundle means a broken `cat` and must be caught before the lenses launch, not after twelve return empty.

**Never inline source code into an Agent prompt.** The prompt points at the bundle file and the subagent reads it. Inlining multiplies token cost by twelve and truncates on large codebases.

Each lens gets its own lens file only. The twelve must stay **independent**: each sees only its own bundle and never another lens's output. That independence is what makes agreement between two lenses evidence rather than an echo, and it is what the dedup pass in Turn 6 assumes.

### Turn 4 — Spawn all twelve lenses

One message, twelve parallel background Agent calls (`run_in_background=true`), `model={agent_model}`, `subagent_type` per the mapping table below. Single phase, no later spawns. You will be notified as each completes — do not poll or sleep.

**Prompt template (substitute real values):**

```
You are 0xSimao auditing this protocol. Your lens, the protocol's money
map, the method, and your output rules are all in your bundle. Read it
fully before producing findings.

Read first:
- {bundle_dir}/lens-N-bundle.md (XXXX lines) — source + money map + method + lens + shared rules.

The bundle contains all in-scope source. Do NOT re-read in-scope files for
the initial scan. Use Read/Grep only for cross-file lookups or out-of-scope
context (interfaces/, lib/, mocks/, test/).

Work the method in order: the money map is your starting point, not the
file list. Pick the tracked totals and lifecycles your lens owns, and
attack those.

A finding is complete only when you have:
- file, contract, function, and the exact line of the root cause
- root cause phrased as the defect, naming the missing or wrong operation
  ("X is never decremented in Y", not "accounting is wrong")
- internal pre-conditions (protocol state) and external pre-conditions
  (market/oracle/chain) — state "None" when genuinely none, the strongest case
- attack path — numbered steps, concrete actors, concrete numbers
- impact — WHO loses WHAT, and specifically who is left holding the loss
- minimal mitigation — the smallest change that removes the defect

Without a concrete attack path and named victim, it is a LEAD, not a
finding. Leads are honest calibration, not failures. Emit them.

Run the closing tests before you finish: the Last User Out test on every
lifecycle, and the saturation sweep (once you find one bug, mine every
sibling site of the same shape — a repeat instance you missed is an audit
failure).

Output format: see shared-rules.md inside your bundle.
```

*Fallback — no subagents.* If your runtime cannot spawn subagents at all, run the lenses yourself in twelve separate sequential passes: read one bundle, emit that lens's findings block in full, then move to the next lens without carrying the previous lens's findings forward. Slower, and weaker because the passes are no longer blind to each other, but the method survives. **Never** collapse the twelve lenses into a single pass over the source — that discards the whole design.

### Turn 5 — Wait, then verify the lenses did the work

Proceed only once all twelve have notified completion. Let them run to natural completion; do not start dedup early and do not poll. A lens that dies without output is a missing lens, not a quiet one — re-run that lens alone against its existing bundle rather than proceeding with eleven.

**Marker check (do not skip).** `shared-rules.md` binds every lens to four reasoning markers, each with a trigger that requires a literal marker in the lens's working text: `[Model: <name>]` when it opens a function that moves value, `[Why: <file:line>]` when it stops on an unclear line, `[Defeat: <function>]` when a path reads as clean, and `[LastOut: <lifecycle>]` when it finishes a lifecycle. After each lens returns, grep its output for those four markers. A lens that returns findings with zero markers did not reason — it scanned, which is the exact failure mode the method exists to beat. A lens with no `[LastOut:]` never ran the solvency test on any lifecycle. Treat either as noncompliant: re-run that lens alone against its existing bundle before dedup, and if it still returns bare, weight its findings down and note the shortfall in the report's methodology line. Do not carry an unverified lens into Turn 6.

### Turn 6 — Deduplicate, judge, report

Single pass: dedup, gate, and produce the final report in one turn. Do not print an intermediate dedup list.

1. **Dedup** per the four hard gates below.
2. **Judge** each deduped finding through the four gates in `severity-calibration.md`, in order, no skipping and no revisiting after a verdict. `UNCERTAIN = ALLOWS`.
3. **Promote or reject leads** per the method: LEAD → FINDING if the full path exists in source, or if `[lenses: 2+]` independently reached it. `[lenses: 2+]` does NOT override a code path that actually interrupts the attack before harm — demote instead. Judge what the code allows, never what the deployer intends.
4. **Classify severity** per the matrix in `severity-calibration.md`.
5. **Construct and verify PoCs — before formatting, while `{bundle_dir}` still exists.** Route every High (and any Medium where a runnable test is cheap) to `security-verifier` or `poc-writer` per the EVM Cortex addendum below, then run the High-finding fix verification. This step MUST precede the print and the cleanup: a printed report cannot gain a PoC after the fact, and Turn 6 deletes the bundle at the end. A High without a landed PoC is not ready — resolve it here, not after.
6. **Format and print** per `report-formatting.md` (`Description` + `Recommended Mitigation` per finding), embedding each High's verified PoC. With `--file-output`, also write the file.
7. **Auto-clean:** `rm -rf {bundle_dir}`. It is transient build state, not an artifact. For debugging, copy it elsewhere before re-running.

---

## Deduplication Gates

Group findings by `group_key` (`Contract | function | bug_class`). Exact match first, then merge synonymous `bug_class` within the same `(Contract, function)`. Keep the best per group, number sequentially, annotate `[lenses: N]`.

Four gates govern this phase. They exist because the failure mode of naive merging is silently deleting real bugs — twelve lenses converging on one function is *information*, not redundancy.

**Gate A — Function isolation (HARD).** NEVER merge across different `function:` values. Dedup only within `(Contract, function)`. A different function is a different bug, always.

**Gate B — Mechanism preservation.** A merged group whose members describe distinct mechanisms — different root-cause line, different mitigation, different attack path — MUST list every mechanism. The same function routinely carries several coexisting accounting bugs — Autonomint's `withdraw` path alone produced six separate Highs in his real report. Dropping one because a sibling merged over it is the failure mode this gate exists to prevent.

**Gate C — Function-level second pass.** After `group_key` dedup, run a second pass at `(Contract, function)` ignoring `bug_class` entirely. Lenses often tag coexisting bugs with different `bug_class` values while referencing multiple mechanisms in the body. For every `(Contract, function)` with multiple final findings, scan every constituent's description, path, proof, and mitigation for distinct mechanisms crossing `bug_class` boundaries. Every mechanism in any constituent body must survive into at least one final finding. Stay *within* `(Contract, function)` — never across, per Gate A.

**Gate D — Mitigation preservation (HARD).** Before writing a merged `mitigation:` for a `(Contract, function)` with multiple findings, collect every raw mitigation and group by the actual change (added require / added decrement / reordered call / changed rounding / restricted target). Two mitigations are distinct if they change different operations or different directions. ≥2 distinct → present as Option A, B… **verbatim** from the lens text, labelled by kind (add-missing-write / validate / reorder / round-other-way / restrict).

**Completeness gate (HARD).** Before printing, enumerate every unique `(Contract, function)` in any raw FINDING or LEAD across all twelve lenses. Every one MUST be *accounted for* — never silently dropped — but "accounted for" is not the same as "reported". Each resolves to exactly one of three fates:

- **reported** — survives as a finding, or as a one-liner in the `## Unverified leads` section;
- **rejected** — a judging gate in step 3 blocked its only attack path, recorded with its one-line rejection reason (these do NOT go into the report — forcing a gate-killed false positive back in is the failure this clause prevents);
- **merged** — folded into another finding on the same `(Contract, function)` per Gates B/C.

A `(Contract, function)` with zero fate is the silent drop this gate exists to catch. Print inline before the report:

```
Completeness: N unique (Contract, function) in raw — R reported, X rejected (with reasons), M merged.
```

**Composite chains.** If finding A's output feeds finding B's precondition AND the combined impact exceeds either alone, add `Chain: [A] + [B]`. He reports these as their own finding when the chain crosses a trust boundary. Most audits produce zero to two.

---

## Severity classification (EVM Cortex addendum)

The vendored `severity-calibration.md` assigns **High / Medium / Low / Info** and this skill keeps that scale intact — do not remap it onto a Critical band. Severity is impact × likelihood, assigned after all four judging gates pass. When genuinely torn between two severities, choose the lower and say why in one line — over-claiming costs credibility, and credibility is the whole product.

### PoC requirements

| Severity | PoC |
|----------|-----|
| High | Working Foundry PoC — mandatory |
| Medium | PoC or clear step-by-step reproduction |
| Low / Info | Description only |

Route PoC construction for every High (and any Medium where a runnable test is cheap) to the `security-verifier` or `poc-writer` agent in **Turn 6 step 5 — before the report is formatted and before `{bundle_dir}` is deleted**, never after. Pin the fork block number in every fork-based PoC so it stays reproducible. A High finding with no PoC is not ready to report.

### Fix verification (High findings)

Trace the proposed mitigation against the original attack path and confirm the path terminates, then check for side effects:

- [ ] Does not introduce a new DoS vector
- [ ] Does not break existing functionality
- [ ] Does not introduce a new reentrancy path
- [ ] Preserves every invariant the money map listed for that lifecycle

---

## EVM Cortex Agent Mapping

| # | Lens | Owns | `subagent_type` | Model |
|---|------|------|-----------------|-------|
| 1 | accounting-desync | tracked totals drifting from reality, the largest class | `depth-token-flow` | opus |
| 2 | share-exchange-rate | claims vs value, round-trip profit, redemption in terminal states | `depth-token-flow` | opus |
| 3 | temporal-cohort | who gets the distribution, join-before / leave-before, index checkpoints | `depth-state-trace` | opus |
| 4 | liquidation-solvency | health math, blocked liquidations, bad-debt clearing | `sleuth` | opus |
| 5 | cross-chain-state | LayerZero/CCIP global-state overwrite, debited-here-credited-nowhere | `depth-external` | opus |
| 6 | rounding-precision | direction, truncation, decimals, casts, overflow | `depth-token-flow` | sonnet |
| 7 | ordering-mev | init races, unprotected protocol swaps, discrete-jump arbitrage | `mev-analyst` | sonnet |
| 8 | dos-griefing | unbounded loops, poisoned batches, pause interactions | `depth-edge-case` | sonnet |
| 9 | access-trust | callbacks, approval abuse, unvalidated targets, composed privilege | `access-control-reviewer` | sonnet |
| 10 | integration-assumptions | token quirks, oracles, external protocols, chain environment | `oracle-analyst` | sonnet |
| 11 | edge-states | zero, one, first, last, expired, paused, capped | `depth-edge-case` | sonnet |
| 12 | flow-completeness | the gap hunter: missing calls, asymmetric branches, absent siblings | `code-reviewer` | opus |

The `subagent_type` selects a base persona and tool set; **the lens file in the bundle is what determines the lens.** Reused types (`depth-token-flow`, `depth-edge-case`) run as independent instances with different bundles and share no context. When Turn 1b sets `{agent_model}`, it overrides the per-lens Model column above.

---

## Pre-Audit Checklist

- [ ] All in-scope files identified via the exclude pattern; in-scope docs added
- [ ] `xray-pre-audit` run, or an equivalent context package assembled
- [ ] `money-map.md` written — assets, tracked totals, asymmetry table, invariants, lifecycles, cohorts
- [ ] Bundle directory created; `source.md` plus twelve lens bundles built
- [ ] Line counts printed for `source.md` and every bundle, and none is undersized
- [ ] `forge build --deny-warnings` passes clean (or Foundry-absent noted)
- [ ] `forge test` passes with no failures
- [ ] Slither baseline report generated
- [ ] Known issues documented to avoid duplicate findings
- [ ] Local `VERSION` checked against upstream

## Post-Audit Checklist

- [ ] All twelve lenses returned findings
- [ ] Findings grouped by `group_key`; function isolation respected (Gate A)
- [ ] Mechanism-preservation gate applied to every merged group (Gate B)
- [ ] Function-level second pass run across `bug_class` boundaries (Gate C)
- [ ] Distinct mitigations preserved verbatim as Option A/B/… (Gate D)
- [ ] `Completeness: N / N` line printed and reconciled
- [ ] Composite chains identified
- [ ] Every finding run through all four judging gates in order, one pass, no revisiting
- [ ] LEADs promoted or rejected with justification; no deployer-intent reasoning used
- [ ] Severity assigned per the matrix in `severity-calibration.md`
- [ ] Foundry PoC written for every High finding
- [ ] Fix verification completed for every High finding
- [ ] Saturation sweep confirmed — every sibling site of each finding checked
- [ ] Report ordered High → Medium → Low → Info; `Description` + `Recommended Mitigation` per finding
- [ ] Unverified leads section included, nothing silently dropped
- [ ] Bundle directory deleted

---

## Banner

Before doing anything else, print this exactly:

```

 ██████╗ ██╗  ██╗███████╗██╗███╗   ███╗ █████╗  ██████╗
██╔═████╗╚██╗██╔╝██╔════╝██║████╗ ████║██╔══██╗██╔═══██╗
██║██╔██║ ╚███╔╝ ███████╗██║██╔████╔██║███████║██║   ██║
████╔╝██║ ██╔██╗ ╚════██║██║██║╚██╔╝██║██╔══██║██║   ██║
╚██████╔╝██╔╝ ██╗███████║██║██║ ╚═╝ ██║██║  ██║╚██████╔╝
 ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝
        follow the money, then find who eats the loss

```
