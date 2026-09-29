---
name: pashov-audit-pipeline
description: Use when performing a comprehensive smart contract security audit. Implements the Pashov Audit Group's parallelized 12-agent attacker-framing methodology (solidity-auditor v4) — nine single-specialty lenses (math precision, access control, economic security, execution trace, invariant, periphery, first principles, asymmetry, boundary) plus three gap-hunters that find bugs living at the seams between lenses. Supports loop mode (N passes per scan, each told what earlier passes found) and a findings ledger that remembers results across scans. Produces a shell-assembled, deduplicated, confidence-scored report plus an EVM Cortex severity and PoC annex. Trigger on "pashov audit", "run the auditor in loop mode", "run 3 passes".
---

# Pashov Audit Pipeline

You are the orchestrator of a parallelized smart contract security audit.

Twelve specialized agents attack the same codebase at once, then their output is deduplicated, gated, and assembled into a single report. Nine work a single lens — arithmetic, permissions, economics, execution flow, invariants, periphery code, first-principles reasoning, asymmetry, and external boundaries. Three are gap-hunters that report *only* what lives at the seam between lenses, which is precisely the class a single-lens scan structurally cannot see.

Vendored from the Pashov Audit Group's open-source approach (`github.com/pashov/skills`), skill `solidity-auditor`, **VERSION 4** (see the `VERSION` file alongside this one). Everything under `references/` is upstream content carried over intact, with four documented EVM Cortex deviations:

1. `references/orchestration.md` is upstream's `SKILL.md`, vendored verbatim so the turn-by-turn procedure (memory read, prune, bundle build, run files, assembly) stays a file-by-file diff against upstream. Where any reference file says "SKILL.md Turn N", it means that file.
2. `references/judging.md` carries an appended severity/PoC addendum required by this repo's finding-output-format, severity-matrix, and poc-execution rules.
3. `on-chain`/`off-chain` are normalized to `onchain`/`offchain` across `references/` prose and in the one disclaimer string `assemble.sh` prints, per this repo's style rule.
4. `assemble.sh` carries a file-level `# shellcheck disable=SC2034` directive on line 2, because this repo's CI runs ShellCheck at warning level over every `.sh` file and the assembler's `read` loops bind TSV columns it does not use. Nothing else in the script differs.

Every other EVM Cortex adaptation — agent mapping, context package, Foundry pre-flight, the severity line in each finding block, and the Turn 6 annex — lives in this `SKILL.md` only, so an upstream re-sync replaces `references/` cleanly. Check for a newer upstream revision before a high-stakes audit:

```bash
curl -sf https://raw.githubusercontent.com/pashov/skills/main/solidity-auditor/VERSION
```

If that returns a number greater than 4, this skill is behind upstream.

## What v4 changed

- **Loop mode.** `--loop [N]` runs N passes of the twelve agents in one scan. Every pass after the first is handed what the earlier passes found as "ground already walked", so it hunts new ground. One combined report at the end. When the runner asks for loop mode without a number, the default is 3 passes; the reference gives measured times (about 15 minutes per pass on a 2,200-line codebase).
- **Scan memory.** `--memory` (on automatically when passes > 1) keeps a ledger at `.solidity-auditor/memory.tsv` in the audited repo. Findings are tagged `KNOWN (n scans)` or `NEW`; records the scan did not raise again are listed under "Known from earlier scans" and explicitly marked not re-checked.
- **Shell-assembled report.** Each pass writes its gated findings to `.solidity-auditor/runs/{stamp}/run-K.md` while it still has context to spare; `references/assemble.sh` is the only producer of `full-report.md`. The orchestrator never composes, re-words, or summarizes the report. A real 3-pass scan that produced 71 findings once printed 14 of them and claimed full coverage; the design exists to kill that defect.
- **Simplified Technical English.** `references/report-language.md` is appended to every agent bundle and governs every title and Description: one sentence, 25 words or fewer, active voice, names who acts and what they get.
- **Threshold 75, not 80.** A promoted lead lands at exactly 75 and must clear the line. It is set once in `judging.md`; the assembler reads it from there.
- **Scope.** Build and dependency directories are excluded; deploy scripts (`script/`, `deploy/`, `*.s.sol`) are **in scope** because they set constructor arguments and hand over ownership; explicitly named files are always scanned wherever they live.
- **Agents are READ-ONLY** inside the audited repository. No PoC files, no scratch notes, not even ones deleted afterwards. PoCs are written under the scan directory (Turn 6).
- **Upgrade warning** fires only when the local `VERSION` is lower than upstream, not merely different.

## The stance: agents are attackers, not reviewers

Every agent is framed as an attacker with unlimited capital and flash loans, not as a reviewer working a checklist. Three consequences worth stating up front, because they invert the instinct:

- **When an agent finds a bug it deepens the attack — it never argues itself out of one.** Chain it, find more victims, lower the precondition cost. Refutation belongs to the judging phase, not the hunting phase.
- **A finding is not real until traced with concrete values.** No proof means LEAD, not FINDING. Leads are not failures; they are honest calibration and they get emitted.
- **Catalog scanning is not the product.** Pattern catalogs live in the sibling skills (`reentrancy-patterns`, `flash-loan-attacks`, `oracle-manipulation`, `signature-vulnerabilities`, `economic-attack-vectors`, `denial-of-service`) — load those for reference. A pure catalog sweep was an earlier generation of this pipeline; it produced volume without depth, which is why upstream dropped the dedicated vector-scan agent in v3.

### When to Use

- Full security audit of a protocol before mainnet deployment
- Re-audit after significant code changes or new feature additions — run with `--memory` so the report says what is new
- Pre-merge security review of high-risk PRs touching core accounting or token logic
- Competitive audit participation where thoroughness and finding volume matter — use loop mode

### When NOT to Use

- Quick sanity check on a single function — use `audit-breadth-scan`
- Static analysis triage — use `slither-analysis` or `aderyn-analysis`
- Gas-only review — use `gas-optimizer`
- Code quality review without security focus — use `code-reviewer`
- Pre-audit reconnaissance and readiness assessment — run `xray-pre-audit` first, then feed its output in as the context package
- Accounting-heavy protocols where the question is "does the tracked total match reality" — run `simao-audit-pipeline` as well and treat overlap as signal

---

## How to run this skill

Follow `references/orchestration.md` turn by turn — Mode Selection, Turn 1 through Turn 5, and its Banner — with the EVM Cortex substitutions and insertions below. The reference files it delegates to sit in the same directory: `agent-prompts.md` (Turn 3a prompts), `dedup-and-assembly.md` (Turn 4 and Turn 5 procedure), `report-formatting.md` (finding-block shape), `report-language.md` (wording), `judging.md` (gates, confidence, lead promotion, severity addendum), `senior-auditor-sop.md` and `hacking-agents/` (bundle content), and `assemble.sh` (the assembler).

Two upstream steps are pinned here because the runtime differs:

- **`{resolved_path}`** is this skill's own `references/` directory. Do not glob for `shared-rules.md` — the installer places a copy under `~/.claude/skills/` and a repo checkout may hold another, and a glob can pick the wrong one.
- **Version check** (Turn 1 e): compare as numbers and warn only when local is lower. Print `⚠️ Upstream solidity-auditor is at version N, this skill is vendored at 4. See https://github.com/pashov/skills`. A failed fetch is skipped silently — a network failure is not an audit finding.

### Turn 1b — Model and pass count

Ask both questions in one `AskUserQuestion` call exactly as the reference describes. The runner's model choice `{agent_model}` applies to agents 1–9. **The three gap-hunters (agents 10–12) run on `opus` regardless of the answer.** Cross-lens reasoning is where model tier matters most; a weaker gap-hunter collapses into restating single-lens findings, which dedup then discards as duplicates — the most expensive way to save money in this pipeline. Say so in one line when the runner picks a lower tier.

If the audited repo's `.gitignore` does not list `.solidity-auditor/`, print a one-line reminder that the runs directory and ledger should be ignored. Do not edit `.gitignore` yourself.

### Turn 2b — Context package (EVM Cortex insertion, once per scan)

After `source.md` is built and before the bundles are catted, assemble, when available: the protocol README, known issues (to avoid duplicate reports), documented design decisions, deployment context (target chains, upgrade strategy), external dependencies, and prior audit reports with resolution status. Write it to `{bundle_dir}/context.md` and append it to every bundle **after `report-language.md` and before `known-findings.md`**. Keep it under 300 lines; the agents' attention belongs to the source.

If `xray-pre-audit` has been run, its `x-ray/x-ray.md` is the best available context package — it already carries the threat model, invariant list, and entry-point classification.

### Turn 2c — Foundry pre-flight (EVM Cortex insertion, once per scan)

Run in the audited repo, writing outputs only under the scan directory:

```bash
forge build --deny-warnings
forge test --summary
slither . --filter-paths "test|script|node_modules|lib" --json .solidity-auditor/runs/{stamp}/slither-report.json
forge tree > .solidity-auditor/runs/{stamp}/dependency-tree.txt
```

`forge build` and `forge test` write only to `out/` and `cache/`, which the scan excludes. A build failure is not a stopper — note it in the context package and continue; the agents read source, not artifacts. If the project is not a Foundry project, skip the `forge` steps and say so.

### Turn 3a — Agent mapping

Use the two prompt templates in `references/agent-prompts.md` verbatim, substituting `{bundle_dir}`, the agent number, and the bundle's real line count. The READ-ONLY paragraph is unconditional; the "Known findings" paragraph appears only when memory is on and `known-findings.md` was appended. Spawn all twelve as parallel background Agent calls with these `subagent_type` values:

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

The `subagent_type` selects a base persona and tool set; **the specialty file in the bundle is what determines the lens.** Reused types (`depth-token-flow`, `mev-analyst`, `sleuth`) run as independent instances with different bundles and share no context. The Model column is the default when Turn 1b set no `{agent_model}`; when it did, agents 1–9 take the runner's choice and 10–12 stay on opus.

### Verifying the agents did the work

`shared-rules.md` binds every agent to three mental tools from `senior-auditor-sop.md`, each with a trigger that requires a literal marker in the agent's output: `[Feynman: <name>]` when it opens a new function, `[Socratic: <file:line> — why?]` when it stops on an unclear line, `[Inversion: <function>]` when a path reads as clean.

After each agent returns, grep its output for those markers. An agent that returns findings with no markers did not reason — it scanned. Note the shortfall as a workflow violation and weight that agent's findings accordingly. Do not respawn it: in loop mode the next pass covers the same lens for free, and on a 1-pass scan a retry costs an unbounded wait for one twelfth of the coverage.

### Turn 4 — Severity line (EVM Cortex insertion, every pass)

Follow `references/dedup-and-assembly.md` Turn 4 step by step. Between step 3 (lead promotion) and step 4 (memory tag), classify every gated **FINDING** per the severity addendum in `judging.md` — impact × likelihood from the global severity matrix, assigned independently of confidence. LEADs are not classified.

In step 5a, write the severity into the finding block's body as one structured line between the Description and the Fix:

````markdown
**Description**
<one sentence>

**Severity** High · Impact High · Likelihood Likely

**Fix**
...
````

The assembler pastes the body through unchanged, so the line reaches the report without any change to `assemble.sh`. It is a structured field, not prose: `report-language.md` rule 10 (no `critical`, `severe` in sentences) governs sentences and does not reach it. Use exactly one of `Critical`, `High`, `Medium`, `Low`, `Informational`, and keep the `**Severity** ` prefix and ` · ` separators exactly — Turn 6 extracts the value by shell.

### Turn 5 — Assemble, print, clean

Follow `references/dedup-and-assembly.md` Turn 5 unchanged. Do not re-word, re-order, add to, or summarize `full-report.md`. The `--file-output` copy is named `{project-name}-pashov-ai-audit-report-{stamp}.md`.

### Turn 6 — Severity and PoC annex (EVM Cortex, once per scan)

Runs after Turn 5, at any pass count. It reads `full-report.md` and never writes to it.

1. **Extract the severity table by shell, never by hand.** One `awk` over the assembled file; the `#` column is the finding's number in `full-report.md`:

```bash
REPORT=.solidity-auditor/runs/{stamp}/full-report.md
awk -v OFS='\t' '
function rank(s){ return (s=="Critical")?0:(s=="High")?1:(s=="Medium")?2:(s=="Low")?3:(s=="Informational")?4:5 }
function flush(){ if (want) { n++; print rank(sev), conf+0, "| " n " | " sev " | [" conf "] | " title " | `" loc "` |"; want=0 } }
/^\[[0-9]+\] \*\*[0-9]+\. / { flush(); match($0,/^\[[0-9]+\]/); conf=substr($0,RSTART+1,RLENGTH-2)
  t=$0; sub(/^\[[0-9]+\] \*\*[0-9]+\. /,"",t); sub(/\*\*[ \t]*$/,"",t); title=t; want=1; sev="Unclassified"; loc=""; next }
want && loc=="" && /^`/ { match($0,/^`[^`]*`/); loc=substr($0,RSTART+1,RLENGTH-2); next }
want && /^\*\*Severity\*\* / { s=$0; sub(/^\*\*Severity\*\* /,"",s); sub(/ ·.*$/,"",s); sev=s; next }
/^Findings List/ { flush() }
END { flush() }
' "$REPORT" | sort -t$'\t' -k1,1n -k2,2nr | cut -f3 > .solidity-auditor/runs/{stamp}/severity-rows.md
wc -l < .solidity-auditor/runs/{stamp}/severity-rows.md
```

The row count must equal `F` from Turn 5 step 3. If it does not, the annex says so in words and lists what it could read — it never claims to cover more than it does. A finding whose block lacks a severity line prints as `Unclassified`; leave it so and say why, rather than editing the assembled report.

2. **Write `.solidity-auditor/runs/{stamp}/severity-annex.md`:**

````markdown
# Severity annex — <project-name>

_EVM Cortex layer over `full-report.md` (same stamp). Severity is impact × likelihood per the global severity matrix and is independent of confidence. `#` is the finding's number in the report. Rows: N of F findings._

| # | Severity | Confidence | Title | Location |
|---|---|---|---|---|
<severity-rows.md, verbatim>

## Proof of concept

_Critical and High findings require a working Foundry PoC before they are reported at that severity. Medium findings need a PoC or a step-by-step reproduction._

| # | Severity | PoC | Status |
|---|---|---|---|
| 3 | Critical | `.solidity-auditor/runs/{stamp}/poc/Exploit_3.t.sol` | passes · fork block 19_000_000 |
| 7 | High | — | pending — routed to poc-writer |
````

3. **Route PoCs.** For every Critical and High finding, spawn `security-verifier` or `poc-writer` with the finding block and the source it names. PoC tests are written **only** under `.solidity-auditor/runs/{stamp}/poc/` — never into the project's `test/` — and run with the test directory overridden so the project tree stays untouched:

```bash
FOUNDRY_TEST=.solidity-auditor/runs/{stamp}/poc forge test --match-path '.solidity-auditor/runs/{stamp}/poc/*' -vvv
```

Pin the fork block in every fork-based PoC. A Critical or High finding whose PoC fails is downgraded in the annex with a one-line reason; the severity line in the run file is left as written — the run file is the pass's record, the annex is this turn's verdict.

4. **Fix verification** for findings at or above the threshold, per the `judging.md` addendum: trace the fix against the attack path, run the side-effect checklist, and pattern-check the rest of the codebase for the same defect.

5. **Print** a five-number summary and the annex path, nothing else:

```
Severity: Critical N · High N · Medium N · Low N · Informational N — annex: .solidity-auditor/runs/{stamp}/severity-annex.md
```

With `--file-output`, also copy the annex to `{project-name}-pashov-ai-audit-severity-{stamp}.md` beside the report copy.

---

## Deduplication gates (summary)

The procedure is `references/dedup-and-assembly.md` Turn 4 step 1 and is followed from there, not from here. The gates are hard, and the failure mode they exist for is silently deleting real bugs — twelve agents converging on one function is *information*, not redundancy:

- **Canonicalise the bug-class label** (new in v4) — one label per (Contract, function) before grouping: the repository's own label from `known-findings.md` wins, then the majority label, then the shortest label that names the defect. Without it one bug becomes three ledger records and is never recognised again.
- **Function isolation** — never merge across `function:` values. A different function is a different bug, always.
- **Wide description** — a merged group with distinct mechanisms lists every mechanism.
- **Function-level second pass** — at (Contract, function) ignoring `bug_class`, every mechanism in any constituent body survives into a final finding.
- **Fix preservation** — distinct fixes are shown verbatim as Option A, Option B, … with intuitive labels.
- **Completeness** — every unique (Contract, function) in raw output has at least one item in the run file; print `Completeness: N unique (Contract, function) in raw, N covered in final.`

Composite chains: `Chain: [A] + [B]` at `confidence = min(A, B)` when A's output feeds B's precondition and the combined impact exceeds either alone. Most audits produce zero to two.

---

## Pre-Audit Checklist

- [ ] All in-scope files identified with the exact `find` command in `orchestration.md` (deploy scripts in, build and dependency dirs out)
- [ ] `xray-pre-audit` run, or an equivalent context package assembled
- [ ] Local `VERSION` (4) checked against upstream
- [ ] `{stamp}` computed once; `.solidity-auditor/runs/{stamp}/scope.tsv` opened with `name`, `mode`, `files`
- [ ] Pass count and model settled in one `AskUserQuestion`; `passes_planned` written
- [ ] Memory on → ledger validated (`#solidity-auditor-memory v1`, 6 columns) or the scan stopped
- [ ] `source.md` built once; twelve bundles built per pass, each ending with `report-language.md` (+ `context.md`, + `known-findings.md` when present); line counts printed and none undersized
- [ ] Foundry pre-flight run; outputs under the scan directory only
- [ ] `.solidity-auditor/` gitignored in the audited repo (reminder printed if not)

## Post-Audit Checklist

- [ ] All twelve agents returned; any loss recorded in the pass summary line, the run-file header, and `pass_K_agents`
- [ ] Mental-tool marker counts verified per agent
- [ ] Bug-class labels canonicalised; function isolation, wide description, second pass, fix preservation, and the completeness line applied per pass
- [ ] Every finding run through the four judging gates in order, one pass, no revisiting
- [ ] LEADs promoted or rejected with justification; no deployer-intent reasoning used
- [ ] Every gated FINDING carries a `**Severity**` line in its run-file block
- [ ] Every run file uses the exact `<!--F …-->` / `<!--/F-->` markers; `assemble.sh` reported no structure break
- [ ] `full-report.md` printed word for word (20 findings or fewer) or as the counted top-3 slice (more than 20); never re-worded
- [ ] Memory on → `memory.tsv` written atomically via `.tmp`; `mem_after` and `mem_sha` recorded
- [ ] Annex row count equals `F`; Foundry PoC passing for every Critical and High, under `.solidity-auditor/runs/{stamp}/poc/`
- [ ] Fix verification and codebase pattern-check completed for findings at or above 75
- [ ] Bundle directory deleted; nothing written outside `.solidity-auditor/` except `--file-output` copies

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
