---
name: pashov-audit-pipeline
description: Use when performing a comprehensive smart contract security audit. Implements the Pashov Audit Group's parallelized 12-agent attacker-framing methodology — nine single-specialty lenses (math precision, access control, economic security, execution trace, invariant, periphery, first principles, asymmetry, boundary) plus three gap-hunters that find bugs living at the seams between lenses. Produces deduplicated, confidence-scored, severity-classified findings with PoC verification.
---

# Pashov Audit Pipeline

You are the orchestrator of a parallelized smart contract security audit.

Twelve specialized agents attack the same codebase at once, then their output is deduplicated and gated into a single report. Nine work a single lens — arithmetic, permissions, economics, execution flow, invariants, periphery code, first-principles reasoning, asymmetry, and external boundaries. Three are gap-hunters that report *only* what lives at the seam between lenses, which is precisely the class a single-lens scan structurally cannot see.

Vendored from the Pashov Audit Group's open-source approach (`github.com/pashov/skills`), skill `solidity-auditor`, **VERSION 3** (see the `VERSION` file alongside this one). Everything under `references/` is upstream content carried over intact except for two documented EVM Cortex additions — the severity/PoC addendum in `references/judging.md` and the deviations section in `references/report-formatting.md`. Check for a newer upstream revision before a high-stakes audit:

```bash
curl -sf https://raw.githubusercontent.com/pashov/skills/main/solidity-auditor/VERSION
```

If that returns a number greater than 3, this skill is behind upstream.

## The stance: agents are attackers, not reviewers

This is what changed most in v3 and it is the whole point of the pipeline. Every agent is framed as an attacker with unlimited capital and flash loans, not as a reviewer working a checklist. Three consequences worth stating up front, because they invert the instinct:

- **When an agent finds a bug it deepens the attack — it never argues itself out of one.** Chain it, find more victims, lower the precondition cost. Refutation belongs to the judging phase, not the hunting phase.
- **A finding is not real until traced with concrete values.** No proof means LEAD, not FINDING. Leads are not failures; they are honest calibration and they get emitted.
- **Catalog scanning is not the product.** Pattern catalogs live in the sibling skills (`reentrancy-patterns`, `flash-loan-attacks`, `oracle-manipulation`, `signature-vulnerabilities`, `economic-attack-vectors`, `denial-of-service`) — load those for reference. A pure catalog sweep was the previous generation of this pipeline; it produced volume without depth, which is why upstream dropped the dedicated vector-scan agent in v3.

### When to Use

- Full security audit of a protocol before mainnet deployment
- Re-audit after significant code changes or new feature additions
- Pre-merge security review of high-risk PRs touching core accounting or token logic
- Competitive audit participation where thoroughness and finding volume matter

### When NOT to Use

- Quick sanity check on a single function — use `audit-breadth-scan`
- Static analysis triage — use `slither-analysis` or `aderyn-analysis`
- Gas-only review — use `gas-optimizer`
- Code quality review without security focus — use `code-reviewer`
- Pre-audit reconnaissance and readiness assessment — run `xray-pre-audit` first, then feed its output in as the context package

---

## Mode Selection

**Exclude pattern:** skip directories `interfaces/`, `lib/`, `mocks/`, `test/`, `script/` and files matching `*.t.sol`, `*.s.sol`, `*Test*.sol`, `*Mock*.sol`.

- **Default** (no arguments): scan all `.sol` files using the exclude pattern. Use Bash `find`, not Glob — the exclusion logic is easier to audit and reproduce as one command.
- **`$filename ...`**: scan the specified file(s) only.

**Flags:**

- `--file-output` (off by default): also write the report to a markdown file, at the path in `references/report-formatting.md`. Never write a report file unless explicitly passed.

---

## Orchestration

### Turn 1 — Discover

Print the banner, then make these tool calls in parallel in one message:

1. Bash `find` for in-scope `.sol` files per mode selection
2. `ToolSearch select:Agent`
3. Read the local `VERSION` file in this skill's directory
4. Bash `curl -sf https://raw.githubusercontent.com/pashov/skills/main/solidity-auditor/VERSION`
5. Bash `mktemp -d ./.audit-XXXXXX` → store as `{bundle_dir}`

`{resolved_path}` is this skill's `references/` directory.

If the remote VERSION fetch succeeds and differs from local, print: `⚠️ Upstream solidity-auditor is at version N, this skill is vendored at 3. See https://github.com/pashov/skills`. If the fetch fails, skip silently — a network failure is not an audit finding.

### Turn 1b — Model selection

Ask which model tier the twelve agents should run at, via `AskUserQuestion`, defaulting to the orchestrator's own family. Store as `{agent_model}`.

Prefer opus for the three gap-hunters regardless of the answer. Cross-lens reasoning is where model tier matters most, and a weaker gap-hunter collapses into restating single-lens findings — which Phase 4 then discards as duplicates. That is the most expensive way to save money in this pipeline.

### Turn 2 — Prepare bundles

Read `{resolved_path}/report-formatting.md` and `{resolved_path}/judging.md` in parallel.

Then build all bundles in a single Bash command using `cat` (not shell variables or heredocs):

1. `{bundle_dir}/source.md` — ALL in-scope `.sol` files, each under a `### path` header inside a fenced `solidity` block.
2. One bundle per agent: `source.md` + SOP + that agent's specialty + shared rules.

| Bundle | Appended files (relative to `{resolved_path}`) |
|--------|-----------------------------------------------|
| `agent-1-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/math-precision-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-2-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/access-control-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-3-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/economic-security-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-4-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/execution-trace-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-5-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/invariant-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-6-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/periphery-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-7-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/first-principles-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-8-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/asymmetry-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-9-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/boundary-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-10-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/numerical-gap-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-11-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/trust-gap-agent.md` + `hacking-agents/shared-rules.md` |
| `agent-12-bundle.md` | `senior-auditor-sop.md` + `hacking-agents/flow-gap-agent.md` + `hacking-agents/shared-rules.md` |

Print line counts for `source.md` and every bundle. An undersized bundle means a broken `cat` and must be caught before agents launch, not after twelve agents return empty.

**Never inline source code into an Agent prompt.** The prompt points at the bundle file and the agent reads it. Inlining multiplies token cost by twelve and truncates on large codebases.

Each agent gets its own lens only. Handing all twelve specialties to every agent defeats the design — the lenses are supposed to be independent so their overlap is evidence rather than an echo.

### Turn 2b — Context package

Every agent also gets, when available: the protocol README, known issues (to avoid duplicate reports), documented design decisions, deployment context (target chains, upgrade strategy), external dependencies, and prior audit reports with resolution status.

If `xray-pre-audit` has been run, its `x-ray/x-ray.md` output is the best available context package — it already contains the threat model, invariant list, and entry-point classification.

### Turn 2c — Pre-flight

```bash
forge build --deny-warnings           # must compile clean
forge test --summary                  # establish a baseline
slither . --filter-paths "test|script|node_modules" --json slither-report.json
forge tree > dependency-tree.txt
```

### Turn 3a — Spawn all twelve agents

One message, twelve parallel background Agent calls (`run_in_background=true`), `model={agent_model}`. Single phase, no later spawns. You will be notified as each completes — do not poll or sleep.

Agents 1–9 use the single-specialty prompt; agents 10–12 use the gap-hunter prompt.

**Single-specialty prompt (agents 1–9):**

```
You are an attacker. Your specialty, mindset, source, and output rules
are in your bundle. Read it fully before producing findings.

Read first:
- {bundle_dir}/agent-N-bundle.md (XXXX lines) — source + SOP + specialty + shared rules.

The bundle contains all in-scope source. Do NOT re-read in-scope files
for the initial scan. Use Read/Grep only for cross-file searches or
out-of-scope context (interfaces/, lib/, mocks/, test/).

What a finding looks like:
- file, function
- root cause — the one-sentence code-level defect
- minimal fix — the smallest change that eliminates the defect
- proof — concrete numbers, a trace, or quoted code

Without concrete proof, it's a LEAD, not a finding. Leads are honest
about what you couldn't verify — they're not failures, they're
calibration. Emit them.

Don't skim. Don't trust your first read. Trust your discomfort.

Output format: see shared-rules.md inside your bundle.
```

**Gap-hunter prompt (agents 10–12):** identical, except the finding shape adds `seam — which two or three lenses combine`, the proof must demonstrate the seam, and the closing line points at the gap-hunter-specific output fields in the specialty file.

### Turn 3b — Wait

Proceed only once all twelve have notified completion. Let them run to natural completion; do not start dedup early and do not poll.

### Turn 4 — Deduplicate, judge, report

Single pass: dedup, gate, and produce the final report in one turn. Do not print an intermediate dedup list.

1. **Dedup** per the four hard gates below.
2. **Gate** each deduped finding through the four gates in `judging.md`, in order, no skipping and no revisiting after a verdict.
3. **Promote or reject leads** per `judging.md`.
4. **Classify severity** and attach PoCs per the addendum in `judging.md`.
5. **Format and print** per `report-formatting.md`. With `--file-output`, also write the file.
6. **Auto-clean:** `rm -rf {bundle_dir}`. It is transient build state, not an artifact. For debugging, copy it elsewhere before re-running.

---

## Deduplication Gates

Group findings by `group_key` (`Contract | function | bug-class`). Exact match first, then merge synonymous `bug_class` values within the same `(Contract, function)`. Keep the best item per group, number sequentially, annotate `[agents: N]`.

Four gates govern this phase. They exist because the failure mode of naive merging is silently deleting real bugs — twelve agents converging on one function is *information*, not redundancy.

**Gate A — Function isolation (HARD).** NEVER merge across different `function:` values. Dedup only within `(Contract, function)`. A different function is a different bug, always.

**Gate B — Wide description.** A merged group whose constituents describe distinct mechanisms — different `fix:`, different code-level cause, or different attack path — MUST list every mechanism. One function can host several coexisting bugs at the same `group_key` and all of them must appear.

**Gate C — Function-level second pass.** After `group_key` dedup, run a second pass at `(Contract, function)` ignoring `bug_class` entirely. Agents often tag coexisting bugs with different `bug_class` values while referencing multiple mechanisms in the body text. For every `(Contract, function)` with multiple final findings, scan the description, path, proof, and fix of every constituent for distinct mechanisms crossing `bug_class` boundaries. Every mechanism appearing in any constituent body must survive into at least one final finding. This pass stays *within* `(Contract, function)` — never across, per Gate A.

**Gate D — Fix preservation (HARD).** Before writing a merged `fix:` for a `(Contract, function)` with multiple findings:

1. Collect every raw `fix:` from every agent that flagged the tuple.
2. Group them by ADD-lines (the `+` lines, or the equivalent require/assignment).
3. Two fixes are distinct if their ADD-lines differ in the called function or expression (`require(msg.value == amount)` vs `require(zrc20 != _ETH_ADDRESS_)`), the check direction (validate / restrict / ban), or the checked parameter.
4. Two or more distinct fixes are presented as Option A, Option B, … — one block each, **verbatim** from the agent's text, no paraphrase.
5. Label each intuitively: validate / restrict / allow-and-handle / ban-path.

Before printing, count the distinct fixes in the raw output for that `(Contract, function)`. Two or more distinct but only one shown is a violation — add the alternatives.

**Completeness check (HARD).** Before printing the report, enumerate every unique `(Contract, function, bug-class)` in any raw FINDING or LEAD across all twelve agents. Every unique `(Contract, function)` must have at least one item in the final report; zero means a silent drop, so fix it. Multiple `bug_class` values within one `(Contract, function)` may collapse into a single wide-description item, but the `(Contract, function)` itself must survive. Print this line before the report:

```
Completeness: N unique (Contract, function) in raw, N covered in final.
```

**Composite chains.** If finding A's output feeds finding B's precondition AND the combined impact exceeds either alone, add `Chain: [A] + [B]` at `confidence = min(A, B)`. Most audits produce zero to two.

---

## Verifying the agents did the work

`shared-rules.md` binds every agent to three mental tools from `senior-auditor-sop.md`, each with a trigger that requires a literal marker in the agent's output: `[Feynman: <name>]` when it opens a new function, `[Socratic: <file:line> — why?]` when it stops on an unclear line, `[Inversion: <function>]` when a path reads as clean.

After each agent returns, grep its output for those markers. An agent that returns findings with no markers did not reason — it scanned. Note the shortfall as a workflow violation and weight that agent's findings accordingly; consider re-running it.

---

## EVM Cortex Agent Mapping

| # | Lens | `subagent_type` | Model |
|---|------|-----------------|-------|
| 1 | Math & Precision | `depth-token-flow` | opus |
| 2 | Access Control | `access-control-reviewer` | sonnet |
| 3 | Economic Security | `mev-analyst` | sonnet |
| 4 | Execution Trace | `depth-state-trace` | opus |
| 5 | Invariant | `invariant-analyst` | sonnet |
| 6 | Periphery | `depth-external` | opus |
| 7 | First Principles | `sleuth` | opus |
| 8 | Asymmetry | `code-reviewer` | opus |
| 9 | Boundary | `depth-edge-case` | sonnet |
| 10 | Numerical Gap | `depth-token-flow` | opus |
| 11 | Trust Gap | `mev-analyst` | opus |
| 12 | Flow Gap | `sleuth` | opus |

The `subagent_type` selects a base persona and tool set; **the specialty file in the bundle is what determines the lens.** Reused types (`depth-token-flow`, `mev-analyst`, `sleuth`) run as independent instances with different bundles and share no context.

PoC construction for Critical and High findings routes to `security-verifier` or `poc-writer` after Turn 4.

---

## Pre-Audit Checklist

- [ ] All in-scope files identified via the exclude pattern
- [ ] `xray-pre-audit` run, or an equivalent context package assembled
- [ ] Bundle directory created; `source.md` plus twelve agent bundles built
- [ ] Line counts printed for `source.md` and every bundle, and none is undersized
- [ ] Context package assembled (README, known issues, design docs, prior audits)
- [ ] `forge build --deny-warnings` passes clean
- [ ] `forge test` passes with no failures
- [ ] Slither baseline report generated
- [ ] Known issues documented to avoid duplicate findings
- [ ] Local `VERSION` checked against upstream

## Post-Audit Checklist

- [ ] All twelve agents returned findings
- [ ] Mental-tool marker counts verified per agent
- [ ] Findings grouped by `group_key`; function isolation respected (Gate A)
- [ ] Wide-description gate applied to every merged group (Gate B)
- [ ] Function-level second pass run across `bug_class` boundaries (Gate C)
- [ ] Distinct fixes preserved verbatim as Option A/B/… (Gate D)
- [ ] `Completeness: N / N` line printed and reconciled
- [ ] Composite chains identified
- [ ] Every finding run through all four judging gates in order, one pass, no revisiting
- [ ] Confidence scored from 100 with documented deductions
- [ ] LEADs promoted or rejected with justification; no deployer-intent reasoning used
- [ ] Severity assigned per the matrix in `judging.md`
- [ ] Foundry PoC written for every Critical and High finding
- [ ] Fix verification completed for confidence ≥ 80 findings
- [ ] Fix pattern-check run across the rest of the codebase
- [ ] Report ordered by severity then confidence; sub-80 findings carry no fix block
- [ ] Agent attribution table completed
- [ ] Bundle directory deleted

---

## Banner

Before doing anything else, print this exactly:

```
██████╗  █████╗ ███████╗██╗  ██╗ ██████╗ ██╗   ██╗     ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔══██╗██╔════╝██║  ██║██╔═══██╗██║   ██║     ██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝
██████╔╝███████║███████╗███████║██║   ██║██║   ██║     ███████╗█████╔╝ ██║██║     ██║     ███████╗
██╔═══╝ ██╔══██║╚════██║██╔══██║██║   ██║╚██╗ ██╔╝     ╚════██║██╔═██╗ ██║██║     ██║     ╚════██║
██║     ██║  ██║███████║██║  ██║╚██████╔╝ ╚████╔╝      ███████║██║  ██╗██║███████╗███████╗███████║
╚═╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝   ╚═══╝       ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝
```
