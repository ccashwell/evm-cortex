---
name: xray-pre-audit
description: Use when preparing for a security audit, performing reconnaissance on a new codebase, or creating a protocol overview. Generates a structured pre-audit readiness report covering architecture overview, threat model, cross-linked protocol invariants, entry point classification and flow paths, composability analysis, test coverage gaps, git history signals, and an architecture diagram.
---

# X-Ray Pre-Audit Reconnaissance

## Overview

X-Ray generates a structured pre-audit **readiness report** that gives auditors (human or AI) a fast, accurate understanding of a protocol before diving into line-by-line review. The output is an `x-ray/` folder at the project root containing:

| File | Contents | Lifetime |
|------|----------|----------|
| `x-ray.md` | Main readiness report — overview, threat model, docs/test analysis, git history, verdict. Under 500 lines. | Kept |
| `entry-points.md` | Protocol flow paths + full entry point classification with call chains and parameter trust levels | Kept |
| `invariants.md` | Complete invariant catalog with stable IDs (`G-N`, `I-N`, `X-N`, `E-N`) that `x-ray.md` cross-links into | Kept |
| `architecture.svg` | Rendered architecture diagram | Kept |
| `architecture.json` | Intermediate machine-readable architecture graph used to build the SVG | Deleted at cleanup |

Adapted for the EVM Cortex squad from the Pashov Audit Group `x-ray` skill (upstream: `github.com/pashov/skills`, skill `x-ray`, **VERSION 2** — see the `VERSION` file alongside this one). The three scripts under `scripts/` are upstream code carried over intact and are the source of truth for enumeration, git security analysis, and SVG generation — the prose here tells you when to call them and how to read their output, never how to reimplement them.

X-Ray is fully autonomous. It runs without user interaction, produces concrete artifacts, and never fabricates findings. When something cannot be determined from the code, it says so explicitly.

### When to Invoke

- A new audit engagement begins and you need to orient quickly
- You are asked to "review", "audit", or "assess" a Solidity codebase
- The `audit-orchestrator` agent kicks off a Light, Core, or Thorough audit
- A developer asks "is this codebase audit-ready?"
- You need to build a threat model or protocol overview from scratch

### Relationship to Other Audit Skills

| Skill | Phase | X-Ray's Role |
|-------|-------|-------------|
| `audit-prep` | Before audit | X-Ray validates audit-prep deliverables |
| `audit-recon` | Phase 1 | X-Ray IS enhanced recon — superset of audit-recon |
| `audit-breadth-scan` | Phase 2 | X-Ray feeds prioritized leads into breadth scan |
| `audit-depth-analysis` | Phase 3 | X-Ray's threat model guides depth agent routing |
| `invariant-testing` | Testing | X-Ray's `invariants.md` IDs become invariant test names |
| `pashov-audit-pipeline` | Full review | X-Ray runs first; its 8 agents consume the threat model and invariant map |

---

## Progress Tracking (Mandatory)

Before doing anything else, call TodoWrite with these three todos, all `pending`:

1. `Phase 1: Enumerate & measure codebase`
2. `Phase 2: Read sources, classify entry points, synthesize invariants`
3. `Phase 3: Write x-ray report files`

Transitions — update via TodoWrite, never batch:

- Mark Phase 1 `in_progress` immediately, before running enumeration.
- When Step 1's parallel batch returns, in ONE TodoWrite call mark Phase 1 `completed` and Phase 2 `in_progress`.
- When Step 2 (including all sub-steps) finishes, in ONE TodoWrite call mark Phase 2 `completed` and Phase 3 `in_progress`.
- After all Step 8 output files are written and the diagram is validated, mark Phase 3 `completed`.

Rule: exactly one todo is `in_progress` at any time. Status updates happen the moment a phase starts or ends.

---

## Step 1: Enumerate & Measure

Before reading any code, quantify the target. Numbers ground the analysis and calibrate effort.

### Project Root & Source Directory Detection

If the user specifies a path, use it as project root. Otherwise use cwd. If no `.sol` files or `foundry.toml` / `hardhat.config.*` at root, check one level deep.

```bash
ROOT="${1:-.}"
cd "$ROOT" || exit 1

# Toolchain
if   [ -f foundry.toml ]; then TOOLCHAIN=foundry
elif [ -f hardhat.config.js ] || [ -f hardhat.config.ts ]; then TOOLCHAIN=hardhat
else TOOLCHAIN=unknown; fi
echo "toolchain: $TOOLCHAIN"

# Source dir: foundry.toml `src = "..."`, else hardhat `contracts/`, else try both
SRC=$(sed -nE 's/^[[:space:]]*src[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' foundry.toml 2>/dev/null | head -1)
[ -z "$SRC" ] && { [ -d src ] && SRC=src; }
[ -z "$SRC" ] && { [ -d contracts ] && SRC=contracts; }
[ -d "$SRC" ] || { echo "ERROR: source directory not found"; exit 1; }
echo "src: $SRC"

mkdir -p x-ray
```

All shell in this skill uses **POSIX ERE only** — no `-P` / PCRE, no GNU-only escapes (`\s`, `\w`, `\b`). This keeps every command identical on macOS BSD grep, Linux GNU grep, and ripgrep. Use `[[:space:]]`, `[[:alnum:]_]`, and explicit alternation instead.

### Enumeration

Run the bundled enumeration script as a single Bash call. It creates the output directory and emits labeled sections consumed by every later step.

```bash
mkdir -p {project-root}/x-ray && bash {SKILL_DIR}/scripts/enumerate.sh {project-root} {src-dir}
```

`{SKILL_DIR}` is this skill's directory. The script covers, in one pass: toolchain detection, source files with line counts, per-file and total nSLOC, NatSpec density, test presence, fuzz/formal-verification detection, docs, current commit, and git history statistics. Do not reimplement any of it inline — the script handles quoting and exclusion edge cases that ad-hoc greps get wrong.

### Version Check

In the same parallel message as enumeration:

```bash
curl -sf https://raw.githubusercontent.com/pashov/skills/main/x-ray/VERSION
```

Compare against this skill's local `VERSION` file. If the remote value is higher, print `⚠️ Upstream x-ray is at version N, this skill is vendored at 2. See https://github.com/pashov/skills`. If the fetch fails, skip silently — a network failure is not an audit finding.

### Reading the Test Signals

Test **presence** comes from the file scan above. It is always reliable, even when the toolchain cannot compile — which is exactly why it is measured separately from coverage.

Multi-signal categories (`echidna`, `medusa`, `halmos`, `certora`) report as `functions:configs`. `5:1` means 5 test functions plus 1 config file. A config with zero functions is worth flagging on its own: the harness exists but nobody wrote properties for it.

| Signal | Reads as |
|--------|----------|
| `test_functions` | Unit/integration breadth (Foundry `function test*` plus Hardhat `it(...)`) |
| `stateless_fuzz` | `testFuzz*` — per-call property testing |
| `foundry_invariant` | `invariant_*` — stateful campaigns in Foundry |
| `echidna` / `medusa` | External stateful fuzzing, as `functions:configs` |
| `certora` / `halmos` / `hevm` | Formal verification: specs/CVL, `check_*`, `prove_*` |
| `fork` | Fork-test count — whether live integration state is exercised at all |

A protocol with high `test_functions` and zero stateful or formal signals is a specific, reportable readiness gap: the state space has never been searched. Route that to `fizz` for an Echidna/Medusa suite.

### Coverage (Background)

Launch coverage in the background. Do not wait for it.

```bash
# Foundry
forge coverage 2>&1 || (echo "RETRYING_WITH_IR_MINIMUM" && forge coverage --ir-minimum 2>&1)
# Hardhat
npx hardhat coverage 2>&1
```

If the toolchain is not installed (`forge: command not found`, missing `node_modules/`), this fails. That is expected and carries **no information about test quality** — see the test-existence rules in Step 8.

### Dependency Snapshot

```bash
forge tree 2>/dev/null | head -40
grep -rE 'openzeppelin|solady|solmate' foundry.toml remappings.txt 2>/dev/null | head -10
ls lib/ 2>/dev/null
```

### Spec / Whitepaper Detection

Glob `**/{whitepaper,spec,design,protocol,architecture,overview,README}*.{pdf,md}`, excluding `node_modules/`, `lib/`, `x-ray/`, `test/`. Skip user-facing docs — tutorials, API references, changelogs, contribution guides. Then apply size-aware handling:

- **Path A (≤5 docs, each ≤300 lines)** — read them directly as part of the Step 2 parallel message. No subagent needed.
- **Path B (>5 docs, or any doc >300 lines)** — launch a single `scout` subagent that reads all doc files and returns a structured extraction of at most 200 lines, with these headings only: Doc-Stated Global Invariants, Actor Definitions, Trust Assumptions, Cross-System Flows, Economic Properties, Key Design Decisions. Require a source quote per claim; omit empty headings.

Extract only: doc-stated global invariants, actor definitions, cross-system flows, trust assumptions, economic properties, key design decisions. Tag every spec-derived claim in the report with `(per spec)` so auditors can tell code-verified from spec-stated. Doc-stated global invariants feed the NatSpec routing pass in Step 5 — they route to §2/§3/§4 of `invariants.md` by shape, never to §1 (which is per-call guards only).

### Parallel Batch Rule

Issue enumeration, background coverage, git analysis (Step 6), the reference doc reads, and the spec glob **in the same message**. Proceed to Step 2 without waiting for coverage.

---

## Step 2: Source Analysis

### Scope Filtering

- Skip interfaces: `interfaces/` directories, or filenames matching `I` followed by an uppercase letter.
- Skip vendored libraries: copies of Uniswap `FullMath`/`TickMath`, OpenZeppelin, Solady, Solmate.
- Skip mocks and test doubles.
- When uncertain, read the file but exclude it from the scope table.

Do NOT read test files or documentation files in this step.

### Two Scan Paths

Choose by in-scope source file count.

#### Path A — ≤20 source files: direct reads

One Read call per file, all in a single parallel message alongside the entry point grep scan. Do not re-read README, docs, or `foundry.toml` — Step 1 already covered them.

#### Path B — >20 source files: fan out to parallel subagents

| Tier | Files | Handling |
|------|-------|----------|
| 1 | ≤120 lines | Batch into a single Bash `cat` call |
| 2 | >120 lines | Group by subsystem; launch one `scout` subagent per subsystem (up to 5 subagents, ~10 files each) |

Each Tier 2 subagent extracts facts only — no analysis — and returns the per-file structure below.

### Per-File Extraction Contract

Both paths must produce the same facts per file:

- **Type** — `contract`, `abstract contract`, `library`, or `interface`
- **Inherits** — full linearization (affects function resolution order)
- **Imports** — libraries and contracts pulled in
- **Roles / access control** — modifiers, role constants, `msg.sender` checks
- **Value-holding state** — mappings and variables holding balances, collateral, stakes, reserves, debt
- **External calls** — every call to another contract, including token transfers
- **Fund flows** — deposit / withdraw / mint / burn / transfer / borrow / repay / liquidate paths
- **Invariant comments** — NatSpec `@invariant` tags, `require`/`assert` statements
- **Backwards-compatibility indicators** — see Step 2c
- **Key logic** — one or two sentences on what the contract does
- **Function-level access map** (contracts only, skip libraries) — every public/external non-view non-pure function with its modifier, or `NONE — permissionless`. For functions with no modifier, also list the external calls they make.

Three extractions carry the invariant synthesis in Step 5 and must be captured precisely:

**Delta writes** — for each non-view non-pure function, the storage variables that change and the symbolic delta applied. Format `Δ(var) = +expr` or `Δ(var) = -expr`. Same-basic-block only; report a pair only when both writes appear in the same function body with no intervening call to an unknown external contract. Do not chase writes through inherited or imported functions unless the semantic effect is unambiguous — OpenZeppelin `_mint` touching `balanceOf` and `_totalSupply` is fine, custom internal helpers are not. List a custom helper's deltas under that helper's own entry.

```
deposit(): Δ(totalSupply) = +shares, Δ(balanceOf[msg.sender]) = +shares
borrow():  Δ(totalBorrows) = +amount, Δ(underlyingBalance) = -amount
```

**Guard predicates** — every `require` / `assert` / `if-revert` that references a storage variable, quoted verbatim with its line number. Skip guards that reference only function parameters.

```
Vault.sol:206: require(_fee <= 10, "fee is capped at 0.1%")
```

**Enum / one-shot transitions** — every `require(var == X); ...; var = Y` pair where `var` is a storage enum, uint, or address. Record as `X@Lx → Y@Ly`. Include one-shot latches such as `require(addr == address(0)); addr = concrete`.

### Entry Point Grep Scan

Issue both greps in the **same parallel message** as the source reads — they are independent.

```bash
# 1. Single-line signatures: name and visibility on the same line
grep -rnE 'function[[:space:]]+[[:alnum:]_]+[[:space:]]*\([^)]*\)[[:space:]]+(external|public)' "$SRC"/ --include='*.sol' \
  | grep -v '/interfaces/' | grep -v '/mock/' \
  | grep -Ev '(^|[^[:alnum:]_])(view|pure)([^[:alnum:]_]|$)'
```

```bash
# 2. Multiline signatures: visibility on the closing-paren line (covers 90%+ of multiline cases)
grep -rnE '^[[:space:]]*\)[[:space:]]+(external|public)' "$SRC"/ --include='*.sol' -B5 \
  | grep -v '/interfaces/' | grep -v '/mock/' \
  | grep -Ev '(^|[^[:alnum:]_])(view|pure)([^[:alnum:]_]|$)'
```

Combine both result sets. The multiline grep is not optional — Solidity routinely splits parameters across lines, leaving `external`/`public` on the `)` line while `function name(` sits several lines above. The trailing filter is the POSIX-portable substitute for `\b(view|pure)\b`: it drops lines where `view` or `pure` appears as a standalone identifier while preserving identifiers like `view_param`.

### Step 2b: Entry Point Classification

Classify **all** entry points using the grep results plus the function bodies. Do not rely on subagent summaries alone — subagents extract facts at contract level and can misattribute which function makes which call or carries which modifier.

Exclude: view/pure functions, interface-only declarations, library internal functions (downstream calls, not entry points), mock contracts.

| Access Level | Criteria | Priority |
|-------------|----------|----------|
| **Permissionless** | No access-control modifier AND no caller restriction anywhere in the function body | HIGHEST |
| **Role-gated** | Role modifier (`onlyRole`, `onlyOwner`, `onlyRouter`, …) OR an internal `msg.sender` restriction. Record which role or address is required. | MEDIUM |
| **Admin-only** | `DEFAULT_ADMIN_ROLE`, `onlyOwner` pointing at protocol admin, or equivalent top-level authority | LOWER, but centralization risk |
| **Initializer** | `initializer` / `reinitializer` — one-time deployment entry points | Track separately |

**A function without a modifier is NOT automatically permissionless.** You MUST verify the body before classifying. In Path A the bodies are already in context — classify directly. In Path B, batch all candidate body reads into a SINGLE parallel message. Look for any of:

```solidity
require(msg.sender == expected);
if (msg.sender != expected) revert Unauthorized();
if (msg.sender != a || cond) revert Unauthorized();   // compound
_checkCaller();                                        // internal check
```

A modifier-free function with an internal `msg.sender` check is **role-gated**. Common offenders: `acceptOwnership()`, `acceptMsig()`, `confirmX()` — no modifier, but restricted to a pending address.

`nonReentrant` alone is NOT access control.

Record per entry point:

| Field | Value |
|-------|-------|
| Contract / Function | `Pool.sol` — `deposit(uint256 assets, address receiver)` |
| Visibility | external, nonReentrant |
| Access level | Permissionless |
| Caller | User |
| Parameters | `assets` (user-controlled), `receiver` (user-controlled) |
| Call chain | `→ Pool._deposit() → Pool._mint() → Strategy.deploy()` |
| State modified | `balances[receiver]`, `totalSupply`, `totalAssets` |
| Value flow | in (tokens: sender → Pool) |
| Reentrancy guard | yes |

Parameter trust levels: `(user-controlled)` the caller picks the value freely, `(user-signed)` the value comes from a user's offchain signature, `(keeper-provided)` a keeper selects it, `(protocol-derived)` read from onchain state.

Call chains use **concrete contract names, not interface names** — write `FuturesManager.addCollateral()`, not `ICollateralManager.addCollateral()`. Interfaces describe how the caller references the target; the auditor needs to know which contract actually executes. The only exception is genuinely external third-party contracts (`IERC20.safeTransfer()`).

The grep scan is a **hard gate**: the permissionless list in the report must match the grep-verified, body-checked result. Where grep plus code reading conflicts with a subagent summary, grep wins.

### Step 2b-flow: Protocol Flow Path Construction

Reorganize the Step 2b data into flow paths for `entry-points.md`. This is not a new analysis pass and needs no new tool calls.

For each major user-facing entry point (permissionless and role-gated functions that move value):

1. Identify its `require` statements and state variable checks.
2. For each check, find which function WRITES that state variable — already known from other entry points' "State modified" field.
3. Chain backwards: destination ← writer of its precondition ← writer of THAT precondition ← … ← deployment.
4. Annotate non-function preconditions (time passage, market conditions, position health, available liquidity) with `◄──`.

Output is simple arrow chains grouped by actor, 15-30 lines total. Reference earlier flows (`[owner setup above]`) instead of repeating them.

### Step 2c: Backwards-Compatibility Code Detection

Watch for code that looks like the remnant of a removed mechanism, kept so the rest of the codebase still compiles. Signals: empty or trivial function bodies, state variables declared but never meaningfully read or written, comments containing "deprecated" / "legacy" / "backwards compat" / "no longer used", interface implementations that always return a default, storage variables preserved solely for proxy layout compatibility.

After reading ALL source files, cross-reference candidates against these mandatory checks. **Batch every caller-check Grep for all candidates into a SINGLE parallel message** — do not verify one at a time.

1. **Caller check (required)** — confirm via Grep that the function or variable has NO active callers. If it IS called from an active path, it is the current design, regardless of whether it returns defaults.
2. **NatSpec / comment check (required)** — if NatSpec or inline comments explain *why* it behaves this way ("simplified for X mode", "by design", "intentionally zero"), this is documented intentional design. Do not override explicit developer documentation with heuristic pattern matching.
3. **Interface obligation check** — a function returning defaults because an interface requires it AND that is actively called is part of the current architecture, not a remnant.

Classify as backwards-compatibility only when ALL of: no active callers, no NatSpec/comments documenting the behavior as intentional, and git history shows the mechanism it belonged to was removed.

Never describe backwards-compatibility code as an active feature. Note it explicitly in Section 1 so auditors do not burn time investigating dead code. If nothing survives the checks, omit the subsection entirely.

### Step 2d: Centralization & Pause Coverage Analysis

Two analyses that feed **into existing report sections**. Neither produces a standalone section.

**Centralization analysis** — for each privileged role (admin, owner, operator, keeper, service):

1. List every operational action the role can take, from the function-level access map.
2. For each action, note whether a timelock, multisig, or delay exists. Distinguish role *transfer* delays (for example `AccessControlDefaultAdminRules`' 1-day delay) from operational *action* delays. A role transfer delay does NOT protect against a compromised holder using instant operational functions.
3. Identify which actions can extract or redirect user funds (`emergencyWithdraw`, `setTreasury`, `transferFee`).

Integrate into **Actors** (Capabilities column states what is instant versus delayed), **Trust Boundaries** (what each boundary actually protects versus what bypasses it), and **Key Attack Surfaces** (framed as "Admin operational powers" or "[Role] compromise" — the surface is the role compromise, not the individual functions).

**Pause coverage analysis** — for each critical state-changing function, check whether `whenNotPaused` or an equivalent applies; note which functions are pausable and which are not. A function that should logically be pausable but is not (for example one callable by a bounded role that operates on user funds) is a detail that worsens that role's compromise scenario — fold it into that role's attack surface rather than raising it independently.

**Anti-pattern: do NOT create a standalone "Centralization Risks" section.** Centralization detail belongs distributed across Actors, Trust Boundaries, Key Attack Surfaces, and Protocol-Type Concerns. A dedicated section duplicates what those already say. Same for pause coverage.

### Step 2e: nSLOC

Use the exact nSLOC TOTAL from Step 1 enumeration — no `~` prefix — in the report header and scope table.

---

## Step 3: Protocol Classification

### Protocol Type Detection

Detect type from function signatures, state variables, and architectural patterns found during Step 2. A protocol may match multiple types. Rank by signal density; the type with the most matches is primary.

| Type | Detection Signals in Code |
|------|--------------------------|
| **Lending / Borrowing** | `borrow()`, `repay()`, `liquidate()`, `liquidationBonus`, `healthFactor`, `collateralFactor`, LTV, `debtToken`, `interestRate`, collateral ratio math |
| **DEX / AMM** | `swap()`, `addLiquidity()`, `removeLiquidity()`, constant-product math, stable-swap invariant, `sqrtPriceX96`, `tick`, LP mint/burn, fee tier, `getAmountOut()`, reserves |
| **Yield Aggregator / Vault** | ERC-4626 pattern (`deposit`/`withdraw`/`convertToShares`/`convertToAssets`), strategy pattern with `harvest()`, `totalAssets()`, `strategyDebt`, auto-compound |
| **Stablecoin** | Mint/burn against collateral, `collateralRatio`, stability fee, `debtCeiling`, redemption mechanism, PSM, `anchor`/`peg`/`target` price |
| **Derivatives / Perps** | `openPosition()`, `closePosition()`, `increaseSize()`, `fundingRate`, `margin`, `leverage`, PnL math, `markPrice`, `indexPrice`, position struct with size/collateral/entryPrice |
| **Liquid Staking** | `stake()` plus derivative token mint, `requestWithdrawal()`, exchange rate calculation, validator set management, withdrawal queue, rebasing or share-based token |
| **Bridge** | Cross-chain message passing, `lock()`/`unlock()` or `burn()`/`mint()`, relayer/validator set, message nonce, chain ID checks, merkle proof verification |
| **Governance** | `propose()`, `vote()`, `execute()`, `queue()`, quorum calculation, voting power snapshots, timelock, delegation, `proposalThreshold` |
| **NFT / Marketplace** | `mint()`, `list()`, `buy()`, `offer()`, royalty, `tokenURI`, `ownerOf`, `setApprovalForAll` |

### Hybrid Classification

1. Rank by signal count — more matches means more weight in the threat model.
2. The **primary** type determines adversary ranking order.
3. **Secondary** types add their unique threats, de-duplicating overlapping ones.
4. State in the report: "Protocol classified as **[Primary]** with **[Secondary]** characteristics."

A protocol with `swap()`, `addLiquidity()`, `borrow()`, `liquidate()` is Primary DEX/AMM, Secondary Lending.

### Temporal Phase Detection

Protocols face different dominant threats at different points in their lifecycle. Detect which phases are relevant from code signals; include only those in the threat model.

| Phase | Include When |
|-------|-------------|
| **Deployment & Initialization** | Always — every protocol has this phase |
| **Steady State** | Always — this is the baseline, covered by the main threat model |
| **Market Stress** | Oracle integration, liquidation logic, collateral/debt tracking, or any price-dependent calculation exists |
| **Governance & Upgrade Windows** | Timelock, governance contract, proxy pattern (UUPS/transparent/beacon), or `propose()`/`vote()`/`execute()` exists |
| **Deprecation & Wind-down** | V2/migration in names or comments, `migrate()` exists, deprecated contract references, or multi-version architecture |

---

## Step 4: Threat Model Construction

The threat model is the analytical core of X-Ray. It maps actors, trust boundaries, and attack surfaces.

### How to Use the Threat Profiles

The profiles below are a threat **identification** library, not prose to paste into the report. Use them to know *what to look for* and *who threatens this protocol*, then translate that into the report's format.

**DO-NOT-EXPLOIT RULE (critical).** Attack surfaces describe the *concern area*, not the exploit. The auditor's value is building the attack path; yours is finding the area fast. If a bullet contains "→ attacker drains X", "→ user trapped", "→ inflated share", "double-counts W", "leads to understated N" — cut it. Replace with "Worth checking…", "Worth tracing…", "Worth confirming…". Name the asymmetry, the divergence, the unusual pattern, the cross-path bookkeeping, then stop.

The exploit-chain prose inside this Step 4 library (for example "oracle manipulation → inflated collateral → drain the pool") is intentional here — it teaches the threat. It is forbidden in the report.

### Actor Enumeration

Only named roles from the code. Never "Anyone". Never "Semi-trusted" — use "Bounded (reason)".

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| EOA User | Untrusted | All permissionless functions |
| Contract User | Untrusted, reentrancy-capable | Same as EOA, plus code execution on callbacks |
| Keeper | Bounded (can only complete CREATED swaps within constraints; not subject to `whenNotPaused`) | `harvest`, `rebalance`, `liquidate` |
| Admin (multisig) | Trusted | 11 instant setters plus pause. `pause` does NOT gate `withdraw`. |
| Timelock | Trusted, delayed | Delayed execution provides an exit window |
| Oracle | External trust | Price data consumed by protocol; manipulation is critical |
| Integrated Protocol | External trust | Protocol depends on their correct operation |
| Flashloan Attacker | Adversarial | Unlimited capital within one transaction |

Capabilities cells are a scannable reference, not a capability paragraph. For roles with many powers, summarize and enumerate only the dangerous ones inline. Aim for two lines per cell.

Then produce an **Adversary Ranking** ordered by threat level for this protocol type, adjusted by git evidence. Three to five entries, ONE sentence each stating WHO they are and WHY they matter here. Attack mechanics and code references belong in Key Attack Surfaces, not here.

### Trust Boundary Map

```
┌─────────────────────────────────────────────┐
│ UNTRUSTED ZONE (public internet)            │
│  Users, Flashloan attackers, MEV searchers  │
├─────────────────────────────────────────────┤
│ PROTOCOL BOUNDARY                           │
│  ┌──────────────┐    ┌──────────────┐       │
│  │ Vault.sol    │───▶│ Strategy.sol │       │
│  │ (entry point)│    │ (internal)   │       │
│  └──────┬───────┘    └──────┬───────┘       │
│         │                   │               │
├─────────┼───────────────────┼───────────────┤
│ EXTERNAL TRUST BOUNDARY     │               │
│  ┌──────▼───────┐    ┌──────▼───────┐       │
│  │ Chainlink    │    │ Aave V3      │       │
│  │ (oracle)     │    │ (lending)    │       │
│  └──────────────┘    └──────────────┘       │
├─────────────────────────────────────────────┤
│ ADMIN TRUST BOUNDARY                        │
│  Multisig → Timelock → Parameter changes    │
└─────────────────────────────────────────────┘
```

For each boundary state what is trusted, the damage if compromised, and whether a timelock or multisig exists. Where a delay protects only the role seat and not operational actions, say so explicitly: "1-day delay protects the admin seat, but `emergencyWithdraw` and `setFee` execute instantly." If git analysis shows boundary code was frequently modified or carries fix-scored commits, append `*Git signal: N modifications, M fix-scored commits — elevated risk.*`

### Protocol-Type Threat Profiles

#### Lending / Borrowing

**Adversaries, ranked**: flash loan attacker (drives oracle manipulation cost to near zero) → oracle manipulator (the oracle is the sole source of truth for solvency) → liquidation MEV searcher (if extraction makes liquidation unprofitable for honest liquidators, bad debt accrues) → malicious first depositor (share-price manipulation on supply/debt tokens) → compromised admin (collateral factors, oracle address, rate model, pause).

**Dominant patterns**: oracle manipulation → inflated collateral → max borrow → drain pool. Flash borrow → manipulate spot → liquidate victim at wrong price. Bad debt via unliquidatable positions (oracle lag, gas spikes, illiquid collateral). Utilization manipulation to move interest rates. Recursive borrowing amplification.

**Critical invariants**: `totalBorrows <= totalCollateral * LTV` per market and per account. Every position is liquidatable before it can cause bad debt. Liquidation is profitable for liquidators. Oracle price is within acceptable deviation and freshness bounds. Interest accrual is monotonic and unmanipulable.

**Look first at**: the complete price path (oracle read → normalization → collateral value → health factor — every step is a manipulation point); whether one transaction can borrow, manipulate, and liquidate; liquidation math against gas plus slippage; share price when `totalSupply == 0`; what admin can change instantly versus through timelock.

#### DEX / AMM

**Adversaries, ranked**: MEV searcher / sandwich attacker (every swap without adequate slippage protection is a guaranteed extraction) → flash loan price manipulator → malicious first LP / empty pool attacker → liquidity manipulation attacker → compromised admin (fees, pause, routing, pool whitelist).

**Dominant patterns**: sandwich attacks. LP share inflation on empty pools via donation. Reentrancy through token callbacks (ERC-777, ERC-1155) while pool state is inconsistent. Spot price exploitation when other protocols read the pool as an oracle. Concentrated liquidity tick manipulation. Fee-on-transfer accounting breaks.

**Critical invariants**: pool invariant holds before and after every operation. LP share value is monotonically non-decreasing from fees. No tokens leave without proportional LP burn or valid swap math. Swap output matches invariant-derived calculation exactly. Tracked reserves match actual balances.

**Look first at**: swap math rounding direction; LP mint/burn at `totalSupply == 0` and minimum liquidity enforcement; whether the pool exposes `getPrice()`/`observe()` (then manipulation has external blast radius); where slippage protection is enforced and whether it can be bypassed; state updates versus external calls in the swap path.

#### Yield Aggregator / Vault

**Adversaries, ranked**: share inflation attacker (deposit 1 wei, donate a large amount, next depositor rounds to 0 shares) → malicious or compromised strategy (strategies hold the actual funds) → reentrancy through external protocol callbacks → donation / direct-transfer attacker → compromised admin (add strategies, allocation weights, harvester, migrate funds).

**Dominant patterns**: ERC-4626 share inflation. Strategy reports fake gain, attacker deposits at inflated price, previous depositors diluted. Strategy retains approvals after migration. Harvest sandwich. Accounting desync when the strategy's real balance drifts from recorded allocation (rebasing, slashing, reward accrual).

**Critical invariants**: `totalAssets()` accurately reflects real underlying value. `convertToShares(convertToAssets(shares)) <= shares` and the reverse. Strategy cannot extract more than allocated. Share price rises only from yield.

**Look first at**: virtual offset or minimum deposit protecting share math; what a strategy may report and who may add or remove strategies; whether `totalAssets()` uses `balanceOf(this)` (donation-exposed) or internal accounting; reentrancy protection and state-before-call ordering; whether migration revokes old approvals.

#### Stablecoin

**Adversaries, ranked**: oracle manipulator → economic/governance attacker (collateral parameters, stability fees) → bank run attacker (strategic redemption drains the best collateral) → flash loan minter → compromised admin (collateral types, oracle, debt ceilings, pause redemptions).

**Dominant patterns**: manipulate collateral price, mint at inflated value, sell, leaving the protocol undercollateralized. Algorithmic death spiral. Redemption DoS draining liquid collateral. Governance-set undercollateralized ratios. Staleness arbitrage between mint and redeem.

**Critical invariants**: every unit is backed by at least the configured collateral ratio. Mint and redeem are inverse — round-trip preserves value. The peg mechanism converges under sell pressure rather than diverging. Liquidation can always restore individual position collateralization. Total supply is within the debt ceiling across all collateral types.

**Look first at**: the mint path (accepted collateral → valuation → ratio → who can change the ratio); the redeem path under stress and whether all units can redeem simultaneously; liquidation profitability; what governance can change and how fast; whether a 10% depeg self-corrects or amplifies.

#### Derivatives / Perps

**Adversaries, ranked**: oracle manipulator (leverage amplifies oracle error — 1% manipulation on 50x is a 50% PnL swing) → liquidation MEV searcher → funding rate manipulator → position size attacker (positions larger than the protocol can pay out) → compromised admin (max leverage, funding parameters, liquidation thresholds, oracle, pause liquidations).

**Dominant patterns**: oracle manipulation triggering cascade liquidation. Funding rate manipulation via concentrated one-sided open interest. Position size exceeding payout capacity. Stale oracle enabling a risk-free directional bet against offchain price. Cross-margin cascades within one account. ADL manipulation.

**Critical invariants**: sum of all PnL is zero minus fees. Available liquidity covers maximum payout under worst-case price movement. Liquidation triggers before any position causes bad debt. Funding rate converges open interest imbalance. Mark price cannot deviate from index price beyond safety bounds.

**Look first at**: PnL math at leverage limits and in both directions; the margin between liquidation trigger and insolvency; how mark price is derived and whether it moves within a block; whether open interest and position size limits are enforced; the maximum funding rate and how fast it can drain margin.

#### Liquid Staking

**Adversaries, ranked**: exchange rate manipulator → validator set attacker → withdrawal queue attacker → oracle/rate arbitrageur (exit at stale rate before a slashing report lands) → compromised admin (validator set, fees, oracle, pause withdrawals).

**Dominant patterns**: rewards or slashing reporting manipulation. Withdrawal queue griefing with spam requests. Rebasing integration bugs in downstream protocols. Validator collusion suppressing rewards. Share price manipulation via direct transfer to the contract.

**Critical invariants**: exchange rate reflects true underlying value (staked plus rewards minus slashing). Total derivative supply times exchange rate is at most total underlying staked. The withdrawal queue processes in fair order. Slashing is reflected in the rate before any user can exit at the stale rate.

**Look first at**: who reports rewards and slashing, how often, and whether it is manipulable; the withdrawal queue delay and griefability; who selects validators; whether the derivative rebases or uses shares; how a massive slashing event is socialized.

#### Bridge

**Adversaries, ranked**: validator/relayer set attacker (the single largest bridge exploit vector by value lost) → message replay attacker → race condition exploiter (source/destination finality gaps, reorgs) → fake message crafter → compromised admin (validator set, pause, upgrade to drain locked funds).

**Dominant patterns**: validator key compromise forging messages to mint unbacked tokens. Message replay from a missing or overflowing nonce. Proof verification bypass. Chain ID confusion. Reorg exploitation after destination minting.

**Critical invariants**: locked tokens on source equal minted tokens on destination. Every message is processed exactly once. Messages cannot be forged without validator threshold consensus. Accounting is consistent across chains.

**Look first at**: validator count, threshold, and how the set changes; nonce presence, checking, and overflow; proof and signature verification edge cases; finality assumptions on the source chain; whether admin can drain locked funds.

#### Governance

**Adversaries, ranked**: flash loan governance attacker (trivial when voting power reads current balance instead of a snapshot) → governance capture attacker (patient accumulation) → proposal spam / griefing attacker → timelock exploitation attacker → compromised guardian (cancel, pause, emergency bypass).

**Dominant patterns**: flash loan → vote → return. Bribe attacks. Proposal obfuscation hiding malicious calldata. Timelock front-running to position before parameter changes execute. Guardian emergency powers used for non-emergencies.

**Critical invariants**: voting power is snapshotted at proposal creation. Quorum prevents minority capture. Timelock delay is long enough for users to exit. No single role bypasses governance for non-emergency actions. Proposal calldata matches its description.

**Look first at**: whether voting power is a snapshot or a current balance; quorum and threshold against actual token distribution; timelock duration; every parameter governance controls; who holds emergency powers and what they can do.

### Cross-Cutting Threats (apply to every protocol)

| Threat | Vector | Impact |
|--------|--------|--------|
| Reentrancy | External call → callback → re-enter state-changing function | Double-spend, state corruption |
| Access control bypass | Missing modifier, wrong role check, initializer re-call | Unauthorized privileged operations |
| Rounding exploitation | Systematic rounding in the attacker's favor across many operations | Slow value drain |
| Griefing / DoS | Revert on transfer, gas griefing, storage bloat | Protocol unusable |
| Upgrade hijack | Unprotected initializer, storage collision, proxy admin takeover | Complete compromise |
| Centralization | Admin key compromise or malicious admin action | Total loss of funds |

### Temporal Threat Phases

Include a "Temporal Risk Profile" subsection covering only the phases that add NEW information beyond Actors, Attack Surfaces, and Upgrade Architecture. Skip Steady State — the main threat model covers it. One to three bullets per phase, each citing a code location and a mitigation status (mitigated / partially mitigated / unmitigated).

**Deployment & Initialization** — the most dangerous 24-48 hours.

| Threat | What to look for |
|--------|-----------------|
| Initialization front-running | `initialize()`/`init()` without access control or the `initializer` modifier; proxies where `initialize` runs in a separate transaction from deployment; permissionless pool or market creation |
| Parameter misconfiguration | Test values still active — zero delays, max-uint fees, known test addresses; constructor/initializer params without validation; insecure defaults |
| Ownership not transferred | `Ownable` with no `transferOwnership()` in the deploy script; two-step transfer not yet accepted; roles not granted to intended addresses |
| Empty-state exploitation | `if (totalSupply == 0)` branches; attacker-chosen initial prices or ratios; deposits when `totalAssets == 0`; missing minimum initial deposit |
| Deployment ordering bugs | Multi-transaction deploy scripts; circular contract references; approval and role-grant chains that must happen in a specific order |

**Market Stress** — where the largest DeFi losses have come from.

| Threat | What to look for |
|--------|-----------------|
| Oracle latency under volatility | The staleness threshold on `latestRoundData()` and whether it fits the asset's volatility; deviation checks; behavior when `updatedAt` is zero or in the future |
| Liquidation cascade | Does liquidation sell collateral on-market (price impact)? Circuit breaker? Throttling? Can it absorb a 30%+ drop in one block? |
| Liquidity evaporation | Liquidation profitability assumptions when depth is thin; assumed swap paths; minimum liquidity requirements |
| Correlated asset depeg | Hardcoded 1:1 price equivalences; using an underlying's oracle for a derivative asset; collateral factors that ignore depeg risk |
| Gas price spikes | Keeper-dependent flows; liquidation incentive versus gas cost; operations bounded by a time window; keeper-failure fallbacks |
| Withdrawal stampede | Withdrawal queues and rate limits; liquid versus deployed share of TVL; how fast strategies unwind; stress-scaling withdrawal fees |

**Governance & Upgrade Windows** — the transition between old and new state.

| Threat | What to look for |
|--------|-----------------|
| Timelock exploitation window | Whether the delay is long enough to exit; parameters exploitable once their pending value is public |
| Upgrade storage collision | `_authorizeUpgrade` protection; storage gap usage; whether upgrades are tested against the real layout |
| Flash loan governance | `balanceOf(msg.sender)` (vulnerable) versus snapshot at proposal creation (immune); borrowability of the governance token |
| Governance capture | Voting power concentration, quorum, cost to buy a passing stake, guardian veto |
| Migration window | V1→V2 transfer mechanisms; whether V1 retains fund access; deadlines; front-runnability |

**Deprecation & Wind-down** — include only with version-transition evidence.

| Threat | What to look for |
|--------|-----------------|
| Residual funds in deprecated contracts | Are old versions reachable? Do they still hold funds? Is migration forced? |
| Abandoned approval chains | Unlimited `approve()` versus `permit()`; any revocation mechanism during migration |
| Dependent protocol breakage | Does this protocol serve as an oracle or data source? Is there a deprecation flag integrators can read? |
| Frozen state exploitation | What breaks if no governance proposal passes for six months? Parameters requiring periodic updates? Automated fallback? |

### Composability & Dependency Analysis

Every external call extracted in Step 2 gets classified into the composability taxonomy. For each call determine:

1. **Target type** — oracle, DEX/AMM, lending pool, yield protocol, token, governance, bridge, other
2. **Assumptions about the return value** — correct price, exact token amount, success, specific format
3. **Validation present** — bounds check, staleness check, zero check, success check
4. **Mutability of external behavior** — can it change without this protocol's consent (upgradeable proxy, governed parameters)?
5. **Fallback on failure** — revert, silent failure, fallback value, try/catch that fails open

Report each significant dependency as a blockquote block:

> **Chainlink ETH/USD** — via `Oracle.getPrice()`
> - Assumes: fresh, positive, 8-decimal price
> - Validates: `answeredInRound` only — NO staleness or deviation check
> - Mutability: feed address settable by admin, no timelock
> - On failure: reverts

**Layer 1 — direct dependency risks.** Oracle dependency chains (protocol → oracle → underlying sources; if any source is manipulable within the trust assumptions, the oracle is manipulable). Yield strategy dependencies (the external protocol holds the actual funds; check upgradeability, pausability, emergency withdrawal, loss socialization, retained approvals after migration). Callback reentrancy (guards that are per-function do not stop cross-function reentrancy; ERC-777 `tokensReceived`, ERC-1155 `onERC1155Received`, flash loan callbacks, swap callbacks).

**Token behavior assumptions.** Report only the ones the code does not validate.

| Assumption | Violating Tokens | Impact if Violated |
|-----------|-----------------|-------------------|
| Transfer sends the exact amount | Fee-on-transfer (PAXG, USDT with fee enabled) | Internal accounting exceeds real balance; protocol becomes insolvent |
| Balance changes only on transfer | Rebasing (stETH, AMPL, aTokens) | Accounting drift, share price manipulation |
| Transfer reverts on failure | USDT (returns false without reverting) | Silent transfer failure, lost funds |
| No callback on transfer | ERC-777, ERC-1155 | Reentrancy through the transfer hook |
| 18 decimals | USDC (6), USDT (6), WBTC (8), GUSD (2) | Math errors, massive over/under-valuation |
| No address blocking | USDC, USDT blacklists | Withdrawals blocked, funds trapped |
| Cannot be paused | USDC, USDT | All protocol operations halt |
| Immutable implementation | Upgradeable tokens behind proxies | Behavior changes post-deployment without consent |

Check whether the code uses the `balanceOf` before/after pattern (handles fee-on-transfer), uses `SafeERC20` (handles non-reverting tokens), reads `decimals()` dynamically, handles rebasing, and whether arbitrary tokens can be used or a whitelist exists.

**Layer 2 — shared state risks.** Liquidity coupling (two protocols using the same pool; a large action here moves prices there within a block). Oracle sharing (the same feed triggering correlated liquidations, with feedback loops back into this protocol). Approval chain exposure (unlimited approvals to an upgradeable contract mean a future upgrade could drain them; deprecated contracts still holding approvals).

**Layer 3 — temporal composability risks.** Governance-induced behavior change in a dependency (no contract interaction changed, but economic assumptions broke — for example a lending market lowering a collateral factor under a strategy assuming the old one). Upgrade-induced interface change (same signature, different behavior, revert conditions, or gas). Deprecation without notification (a feed returns stale data silently, or starts reverting into a fail-open try/catch). Dependency-of-dependency upgrades — map the chain two to three levels deep and flag chains deeper than two levels, noting for each level whether it is upgradeable and governed.

---

## Step 5: Invariant Synthesis

Invariants are properties that must hold across ALL state transitions. This step is a reasoning pass over the Step 2 extractions — delta writes, guard predicates, transitions, invariant comments. It needs no new tool calls except the batched write-site Greps in the guard-lift pass.

The output is `invariants.md`, a catalog of blocks with **stable IDs** that `x-ray.md` cross-links into.

### Terminology: Guards Are Not Invariants

A **guard** is a per-call precondition enforced at a single callsite — `require(amount >= MIN)`. It is not falsifiable: the code guarantees it at that callsite. It feeds §1 of `invariants.md` (Enforced Guards reference) only.

An **invariant** is a property that must hold globally across any sequence of calls — "every active position is at least MIN". Invariants that are *lifted* from guards, or stated in NatSpec, feed §2/§3/§4.

### ID Scheme

| ID | Section | Meaning |
|----|---------|---------|
| `G-N` | §1 Enforced Guards | Verbatim per-call precondition with location and purpose |
| `I-N` | §2 Inferred, Single-Contract | Conservation / Bound / Ratio / StateMachine / Temporal |
| `X-N` | §3 Inferred, Cross-Contract | Caller assumption paired with callee write sites |
| `E-N` | §4 Economic | Higher-order property derived from specific `I-N` / `X-N` |

IDs are stable within a run and are written as `#### G-1`, `#### I-17`, `#### X-4` H4 headings — never as table rows. H4 headings produce slug anchors (`#g-1`, `#i-17`) that cross-file markdown links resolve reliably in VS Code and on GitHub. Inline `<a id>` anchors inside table cells do NOT work cross-file, which is why referenced IDs must never live in tables.

### NatSpec Routing (run before the structural walk)

For each NatSpec `@invariant` tag or inline comment asserting a global property — "totalSupply always equals Σ balances", "fee never exceeds MAX_BP", "only one active epoch at a time" — route DIRECTLY to §2, or §3/§4 if the property spans contracts or derives from multiple primitives, classified by shape. Source tag: `NatSpec: Contract.sol:LN`. Do NOT place developer-stated global invariants in §1 — §1 is per-call guards only.

Doc-stated global invariants from Step 1's spec extraction route the same way.

After routing, still run the structural scans. They confirm (`Onchain: Yes`) or contradict (`Onchain: No`) the stated claim.

### Walk Order

Each step uses the raw extraction data, not prior-step conclusions.

**1. Conservation scan.** For each function, find delta-write pairs where `Δ(A) = +expr` and `Δ(B) = -expr` (or `Δ(B) = +expr` for a mapping counterpart) in the same body. Each matched pair is a conservation candidate: `A + B = const` or `A == Σ B[key]`.

- Mapping writes paired with a scalar (`mapping[key] += e` plus `scalar += e`) imply `scalar == Σ mapping[key]`. Verify the pattern across ALL functions writing either variable. If any function writes one without the other, note it as partial conservation and split into separate Yes/No blocks.
- Transfer patterns (`mapping[from] -= e`, `mapping[to] += e`, no scalar change) confirm the mapping sum is self-conserving.
- **Negative conservation** matters: a function that *ought* to track a flow (flashloan pull/push, receive/forward) but has zero storage Δ is a Conservation-negative finding. Absence of Δ is itself an invariant observation.

**2. Guard extraction and lift.** Two passes over every `require` / `assert` / `if-revert`.

*Pass A — extract verbatim.* Every guard becomes a `G-N` block in §1, quoted verbatim with its source location and a purpose line. This is a mechanical dump of per-call preconditions — not falsifiable, not fuzzed. Skip guards that reference only function parameters with no storage tie-back AND carry no global implication.

*Pass B — lift, then check all write sites.* For each guard ask: does this imply a property that must hold across any sequence of calls, not just at this callsite?

- **No** (the guard constrains a transient parameter consumed by the function, with no tie to persistent storage) → leave it in §1. Do not promote.
- **Yes** (`require(amount >= MIN)` at deposit implies "every active position ≥ MIN"; `require(_fee <= 10)` at a setter implies "fee ∈ [0, 10]") → rewrite it as a global property, then locate ALL write sites of the constrained storage variable with Grep on the variable name across scope files. **Batch every write-site Grep for every lifted guard into a SINGLE parallel message.**
  - ALL write sites enforce an equivalent guard → promote to §2 as a Bound invariant, `Onchain: Yes`. Derivation cites the guard plus the confirmed write-site enumeration.
  - ANY write site writes the variable without an equivalent guard → promote to §2 as a Bound invariant, `Onchain: No`, citing the unguarded write site as the gap. **This is the high-signal output** — the gap is simultaneously an invariant and a potential bug.

Include setter-level bounds where a setter writes a storage variable constrained by its own parameter check. Run the same all-write-site check: if several setters write the same variable but only some enforce the bound, the property is `Onchain: No`.

**3. Ratio scan.** For each storage write of the form `A = B * C / D` where B, C, D are storage variables or function-scoped snapshots of storage, record the ratio. Note whether the snapshot is taken before or after other state changes in the same function — ordering matters (`totalSupply` snapshotted before `_burn` versus after).

**4. State machine / one-shot scan.** For each enum/uint/address in a `require(var == X); ... var = Y` pattern, record the transition and classify:

- **One-shot latch** — `require(var == default); var = concrete` with no path back (`setStrategy`, `setLeverager`). Keep.
- **Togglable flag** — `require(var == false); var = true` but another function flips it back (`freeze`/`unFreeze`). NOT a state machine invariant — drop.
- **Cyclic state** — `false → true → false` driven by timing or condition. Record as a cycle invariant.

**5. Temporal scan.** For each `block.timestamp` or `block.number` comparison involving a storage variable (deadline, lastUpdate, lockPeriod, interval), extract the constraint. Note whether it is checked-then-updated (safe) or updated-then-checked (potential stale read).

**6. Cross-contract scan.** For each external call whose return value feeds arithmetic or a storage write, record what the caller assumes. Then find the callee's write sites for that state. If the callee can change it independently through another function, the assumption is unvalidated — record as `X-N` with `Onchain: No`. Include a block ONLY when BOTH sides are inside the scope files; never speculate about out-of-scope contracts.

Also include **setter-versus-invariant mismatches** — an admin setter writing a storage value without checking that existing invariants still hold (`setReserveCapacity` without checking current liquidity). These are cross-contract in the sense that the setter sits in one place and the invariant is enforced elsewhere.

**7. Economic derivation.** After steps 1-6, check whether any combination of single-contract and cross-contract invariants implies a higher-order property. Each `E-N` must cite the specific `I-N` / `X-N` IDs it derives from. If any source invariant in the chain is `Onchain: No`, the economic invariant is `Onchain: No` too.

### Verification Gate (mandatory before including any inferred invariant)

| Type | Gate |
|------|------|
| Conservation | The Δ-pair exists at the cited lines, in the same function body |
| Guard (§1) | The `require`/`assert`/`if-revert` is verbatim from code |
| Guard lift (§2) | The lifted property references persistent storage, not a restated transient parameter. All write sites of the constrained variable are enumerated via Grep, and the Yes/No verdict matches the enumeration. A `Yes` with an unguarded write site is invalid. |
| NatSpec | The tag or comment exists verbatim at the cited location AND asserts a global property. A per-call note is dropped, not routed to §2. |
| Ratio | The formula is exact and snapshot ordering is noted |
| StateMachine | Both sides of the edge exist AND no reverse path exists. A reverse path means it is a togglable flag — drop. |
| Temporal | The comparison involves a storage variable, not just `block.timestamp` versus a parameter |
| Cross-contract | Both the caller usage and the callee write site exist in scope |
| Economic | Every referenced `I-N` / `X-N` is itself verified |

If you cannot verify, drop the block. "Could not verify" is not a valid block.

### Cross-Linking Invariants to the Report

This is what makes the invariant map usable rather than decorative. When writing Key Attack Surfaces in `x-ray.md` Section 2, cross-reference each surface against the `invariants.md` blocks. If the surface's cited `file:line` falls within the `Location` / `Derivation` / `Caller side` / `Callee side` window of any `G-N` / `I-N` / `X-N` / `E-N` block, append the matching IDs as bracketed markdown links immediately after the surface title, using **lowercase** slug fragments:

```
- **`withdrawFromInvestment` unchecked subtraction** &nbsp;&#91;[X-4](invariants.md#x-4), [I-17](invariants.md#i-17)&#93; — ...
```

Surfaces that are purely access-control or upgradeability concerns may be left unlinked — that is a healthy signal, not a gap. On a non-trivial protocol, expect at least 70% of surfaces to link to at least one invariant. A much lower rate means the invariant walk was too shallow.

The same IDs give downstream agents stable handles: `invariant-tester` names Foundry invariant tests after them, `poc-writer` references the `Onchain: No` blocks it is trying to falsify.

### Invariant Categories

| Category | Shape |
|----------|-------|
| **Conservation** | Two or more storage variables change by equal-and-opposite amounts in the same body: `Δ(A) = +x, Δ(B) = -x` → `A + B = const` |
| **Bound** | A guard on a storage variable lifted to a global property and enforced at every write site: `require(x <= MAX)` at every writer → `x ∈ [0, MAX]` globally |
| **Ratio** | A storage variable defined as a formula of others: `withdrawAmount = totalBalance * shares / totalSupply` |
| **StateMachine** | A storage variable transitions through discrete values with guards preventing reversal |
| **Temporal** | A condition depends on `block.timestamp`, `block.number`, or a duration/deadline variable |

---

## Step 6: Git History Analysis

Git history reveals what the team worries about, where complexity lives, and what has been fixed.

### Branch Scoping (critical)

The analysis is scoped to the **current branch only** (HEAD). Every git signal — fix candidates, hotspots, dangerous areas, late changes — reflects ONLY commits reachable from HEAD, not other branches.

1. State the analyzed branch in the report header or git section: "Analyzed branch: `[branch]` at `[commit]`".
2. When describing fix commits or code changes, describe them as what the **current branch code** does — not what a fix "changed", unless you can see the before and after on this branch.
3. Never describe code state from another branch. The source files read in Step 2 are the current branch's files; git history describes how those files evolved on this branch only.
4. If the repo is a squashed import (one source-touching commit), there is no meaningful evolution. State that and skip fix and hotspot analysis.

Do NOT pass `--all` to any of these commands. `--all` silently pulls in other branches and breaks every claim above.

### Collection

Run the bundled analyzer. It is dependency-free and emits structured JSON, which is far more reliable to reason over than a pile of ad-hoc `git log` output. Issue this in the Step 1 parallel batch:

```bash
cd {project-root} && python3 {SKILL_DIR}/scripts/analyze_git_security.py \
  --repo . --src-dir {src-dir} --json x-ray/git-security-analysis.json 2>&1 \
  && cat x-ray/git-security-analysis.json
```

The JSON has eight sections:

| Section | Contents |
|---------|----------|
| `meta` | Analyzed repo, source dir, branch, and commit — quote these in the report header |
| `repo_shape` | Commit counts, age, contributor line attribution, squashed-import detection |
| `fix_candidates` | Commits whose subjects suggest a bug or security fix, for scoring below |
| `dangerous_area_changes` | Commits touching security-sensitive areas |
| `late_changes` | Recent source changes — code the team has had least time to review |
| `forked_deps` | Vendored or forked dependencies that diverge from upstream |
| `tech_debt` | TODO / FIXME / HACK / XXX / BUG markers in scope |
| `dev_patterns` | Bus factor, review patterns, merge behavior |

The script scopes itself to HEAD. Do not add `--all` or substitute hand-written `git log` commands — both break the branch-scoping guarantees above.

Enumeration (Step 1) already emits overlapping git statistics (`git_hotspots`, `git_large_diffs`, `git_recent_30d`, `git_contributors`). Use those for the coarse picture and this JSON for the security-specific reasoning; do not run a third set of commands to re-derive either.

### Repo Shape

| Classification | Detection | Consequence |
|---------------|-----------|-------------|
| `squashed_import` | ≤1 commit touches source files, or ≤3 source commits within 7 days | No development history — skip fix and hotspot analysis, state this explicitly |
| `normal_dev` with bulk import | One commit contributes >85% of all source lines added, but real development follows | Analyze only the post-import commits |
| `normal_dev` | Neither of the above | Full analysis applies |

### Fix-Candidate Scoring

Score each source-touching commit. The score is a weighted sum, floored at zero. **10 or higher warrants reading the diff manually.** Report commits scoring 5 or higher.

*Intent from the commit subject — first match wins, sets the base:*

| Signal | Base |
|--------|-----:|
| security, vulnerab, exploit, attack, CVE-N, reentran, overflow, underflow, front-run, malleab | +8 |
| hotfix, emergency, critical | +6 |
| fix / fixes / fixed, bug, patch, broken | +4 |
| harden, mitigat, protect, restrict, sanitiz, validat | +2 |
| leading feat / add / implement / introduce / support | −1 |
| leading docs: / chore: / ci: / test: / style: / build:, or readme, typo, format, lint, rename, refactor, cleanup, comment | −3 |

*Topic tags — checked independently, +2 each, applied only when the base is non-negative:* oracle / price / liquidat / slippage / MEV; reentran / overflow / underflow / front-run; ecrecover / permit / signature / nonce.

*Structural diff signals — read the diff and count added versus removed:*

| Signal | Score |
|--------|------:|
| Net addition of `require`/`revert`/`assert` | +3 |
| Net removal of `require`/`revert`/`assert` | +3 |
| Equal-count rewrite of guards | +2 |
| Net addition of `onlyOwner`/`onlyRole`/`nonReentrant`/`whenNotPaused`/`initializer` (tightening) | +3 |
| Net removal of the same (loosening) | +3 |
| Equal-count rewrite of access control | +2 |
| Touches `safeTransfer*`/`.transfer(`/`transferFrom`/`.call{value` | +2 |
| Touches `ecrecover`/`permit`/`ECDSA`/`EIP-712`/`nonce` | +2 |
| Touches `balance*`/`totalSupply`/`exchangeRate`/`index`/`reserve` | +1 |

Both adding and removing a guard score equally. Adding one may fix a vulnerability; removing one may introduce it. Report the direction so the auditor knows which to expect.

*Domain overlap:* the commit's files span ≥2 security areas → +3; exactly 1 → +1.

*Shape modifiers:* 1-3 source files touched (focused) → +2; net code removal → +1; includes test changes → +1; source churn >500 lines → −2; >2000 lines → −4.

### Security Areas

Classify each source file by grepping its content, then use the classification for both domain-overlap scoring and the Dangerous Area Evolution table.

| Area | Patterns |
|------|----------|
| `access_control` | `onlyOwner`, `onlyRole`, `modifier only`, `AccessControl`, `Ownable2Step`, `require(msg.sender`, `hasRole`, `_checkRole` |
| `fund_flows` | `.deposit(`, `.withdraw(`, `.transfer(`, `.mint(`, `.burn(`, `collateral`, `safeTransfer`, `balanceOf`, `allowance`, `approve` |
| `oracle_price` | `oracle`, `price`, `feed`, `TWAP`, `markPrice`, `indexPrice`, `latestRoundData`, `getPrice`, `EMA` |
| `liquidation` | `liquidat`, `backstop`, `ADL`, `deleverage`, `insurance`, `insolvenc`, `badDebt`, `isLiquidatable` |
| `signatures` | `ecrecover`, `permit`, `signature`, `EIP-712`, `ECDSA`, `nonce`, `digest`, `_hashTypedData` |
| `state_machines` | `status =`, `state =`, `Phase`, `Stage`, `lifecycle`, `transition`, `paused`, `frozen`, `isActive`, `whenNotPaused` |

Areas with high commit counts warrant deeper review — frequent changes to security-critical code correlate with higher defect density.

### Forked Dependencies

Check `lib/` and vendored directories against known upstreams (OpenZeppelin, Solady, Uniswap V2/V3, Aave, Chainlink, Permit2). Skip `forge-std` and `ds-test`.

A library present as a git submodule at a tagged upstream commit is normal. A library **internalized** into the repo — copied in, no submodule — is hidden attack surface: the team may have introduced bugs while adapting it, and upstream security fixes will not propagate. Compare pragmas against the expected upstream range; a pragma mismatch is strong evidence of modification.

### Interpreting Signals

| Signal | Meaning | Action |
|--------|---------|--------|
| File changed 20+ times in 3 months | Unstable or complex — high bug density | Prioritize for depth analysis |
| Fix commits concentrated in one file | Known bug area | Check whether the fixes are complete |
| Single author on a critical contract | Bus factor 1, less review | Extra scrutiny |
| Zero merge commits | Likely no peer review process | Flag in Review Signals |
| Low test co-change rate | Source changed without test files changing | Flag as co-modification risk, NOT as a coverage claim |
| Reverted commits | Something went wrong | Investigate what and why |
| Large commit touching many files | Refactor or rushed feature | Check for regressions |
| Burst of commits right before audit | Late unreviewed changes | Highest-priority review targets |
| TODO/FIXME in a security-critical path | Acknowledged incomplete work | Cross-reference against attack surfaces |

The test co-change rate measures file co-modification within commits. It is NOT a coverage metric. Never claim "commits without tests" on the basis of a coverage tool failure.

If any git command fails, fall back to plain `git log` statistics. Never block on git analysis.

---

## Step 7: Architecture Graph & Diagram

Build a machine-readable graph, then render and validate a diagram from it.

### architecture.json Format

```json
{
  "title": "[Protocol] Architecture",
  "nodes": [
    {"id": "vault", "label": "Vault", "subtitle": "Coordinator", "type": "protocol", "row": 1}
  ],
  "edges": [
    {"from": "user", "to": "vault", "label": "deposit assets"}
  ],
  "groups": [
    {"label": "Vault Layer", "nodes": ["vault", "strategy"]}
  ]
}
```

Node types: `actor` for users and roles, `protocol` for in-scope contracts, `external` for out-of-scope dependencies. `subtitle` is a short role line; for composite nodes list the individual contracts there.

Assign `row` to **minimize edge distance**, not by node type. Place each node on the row adjacent to its primary caller. Actors usually land at the top and leaf dependencies at the bottom, but an external node called only from row 1 belongs on row 2, not on a distant "externals" row.

**Group containment rule.** Every node must be either inside exactly one group, or on a row that has no group box at all. A group box spans all rows containing its nodes, so an ungrouped node sharing a row with a group will visually escape or overlap it. Fix by adding it to the right group or moving it to another row. Classify a node's group by its **primary caller** — an ACL contract called by the coordinator belongs in the coordinator's group, not a downstream infrastructure group.

### Budgets

| In-scope contracts | Max nodes | Max edges | Max per row |
|--------------------:|----------:|----------:|------------:|
| ≤10 | 12 | 14 | 4 |
| 11-20 | 16 | 18 | 4 |
| 21-35 | 20 | 22 | 5 |
| 36+ | 24 | 26 | 5 |

Prioritize completeness over compression. Every contract that holds funds, gates access, or sits on a critical call path must be visible — as its own node or clearly named in a composite node's subtitle.

### Compositing Rules

Apply in order; use the first tier that fits the budget.

1. **Always composite** — same subsystem, identical caller AND callee. Label with the subsystem name, list contracts in the subtitle.
2. **When budget requires** — same primary caller OR callee. Helper and satellite contracts fold into their parent node.
3. **Last resort** — same subsystem, same trust level, different callers and callees.

**Never composite across trust levels.** Merging permissionless and admin-only nodes hides trust boundaries. Combine actors only when they share both trust level and capabilities. External dependencies that are the sole data source for critical logic (oracles, price feeds) get their own node.

### Layout Rules

- At most 2 same-row arcs per node. If 3 or more are needed, move one target to an adjacent row.
- Balance directions: with 2 same-row arcs from one node, send one left and one right.
- A node with 3+ same-row connections is a hub — position it centrally among its same-row targets in the `nodes` ordering so arcs fan out cleanly.
- Route a long same-row arc below the row when it would otherwise cross intermediate boxes. Stagger multiple below-arcs at different depths.
- Every edge label is unique — never repeat a label. Two to three words max.
- No row-skipping edges. Every edge connects adjacent rows or the same row. If an edge would span two or more rows, move the target to an adjacent row.
- Show primary interaction flows only, not every internal call.

### Render and Validate

Do NOT hand-author the SVG. Write `architecture.json`, then generate the SVG with the bundled script:

```bash
python3 {SKILL_DIR}/scripts/generate_svg.py x-ray/architecture.json x-ray/architecture.svg
```

The generator is dependency-free and handles all styling and geometry: rounded node boxes, an accent stripe by node type (`protocol`, `external`, and pill-shaped `actor`), labeled arrows, and group enclosure rects. It also auto-assigns layers via longest-path when `row` is omitted, so hand-tuning rows is optional rather than required.

Because layout is deterministic, the failure modes that remain are *content* problems in the JSON, not rendering problems. Optionally rasterize for a sanity check — use the first renderer that works:

```bash
convert -density 300 x-ray/architecture.svg /tmp/architecture-preview.png
rsvg-convert x-ray/architecture.svg -o /tmp/architecture-preview.png
python3 -c "import cairosvg; cairosvg.svg2png(url='x-ray/architecture.svg', write_to='/tmp/architecture-preview.png', scale=3)"
```

If no renderer is available, skip the visual check — the SVG is still valid. Note the skip in the report.

**Content checklist — fix in `architecture.json` and regenerate, max 2 iterations:**

1. **Budgets respected** — node, edge, and per-row counts within the table above.
2. **No row-skipping edges** — every edge connects adjacent rows or the same row.
3. **Group containment** — every node is in exactly one group, or on a row with no group box.
4. **Trust levels intact** — no composite merges a permissionless node with an admin-only one.
5. **Critical contracts visible** — everything that holds funds, gates access, or sits on a critical path appears as a node or is named in a composite's subtitle.
6. **Edge labels unique** — two to three words, never repeated.

Never edit the generated SVG directly. It is a build artifact; the next regeneration discards the edit.

### Cleanup

```bash
rm -f x-ray/architecture.json /tmp/architecture-preview.png
```

---

## Step 8: Report Generation

### Test Existence vs Coverage Execution (critical)

These are **independent signals** and conflating them produces false claims.

**Test presence** comes from Step 1 enumeration — `test_files`, `test_functions`, `stateless_fuzz`, `foundry_invariant`, `echidna`, `medusa`, `hardhat_fuzz`, `fork`, `certora`, `halmos`, `hevm`. These are file-scan results and are ALWAYS reliable, regardless of whether the toolchain can compile or run.

**Coverage metrics** (line and branch percentages) come from `forge coverage` or `hardhat coverage`, which need installed dependencies, successful compilation, and passing tests. Coverage fails for reasons unrelated to test quality: dependencies not installed, stack-too-deep, compiler version mismatch, missing RPC or fork config.

Rules:

1. Use `test_files` / `test_functions` from enumeration for ALL test existence claims. Never infer "no tests" from a coverage tool failure.
2. **Never report a coverage number that was not actually produced.** If coverage fails, write `"[N] test files with [M] test functions detected; coverage metrics unavailable — [failure reason]"`. If it is still running, write `Pending`. Do not estimate, interpolate, or carry over a number from a previous run.
3. In the Gaps subsection, flag only missing test *categories* (`stateless_fuzz` = 0, `foundry_invariant` = 0, and so on). Never claim "no tests" when enumeration found test files. Prioritize by audit impact: missing stateful fuzz and formal verification on math-heavy financial logic outranks missing fork tests.
4. In git Security Observations, never claim "commits without tests" from a coverage failure. `test_co_change_rate` measures file co-modification in commits — qualify it as such.
5. Do not let a coverage failure cascade into the threat model or risk assessment.

Check the background coverage job's status once: include results if done, the failure reason if failed, `Pending` if still running. Do NOT wait.

### Write All Output Files in Parallel

Write `x-ray.md`, `entry-points.md`, `invariants.md`, and `architecture.json` in a SINGLE message so they are created concurrently.

### x-ray.md Template

```markdown
# X-Ray Pre-Audit Report

> [Protocol] | [nSLOC] nSLOC | [short-hash] (`[branch]`) | [framework] | [DD/MM/YY]

---

## 1. Protocol Overview

**What it does:** [One sentence — the core mechanism.]

- **Users**: [Who interacts and why]
- **Core flow**: [The main user-facing operation]
- **Key mechanism**: [AMM type, vault model, oracle design]
- **Token model**: [What tokens exist and their roles]
- **Admin model**: [Who controls what]

For a visual overview see the [architecture diagram](architecture.svg).

### Contracts in Scope

[Group by subsystem — one row per subsystem, not per file.]

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|

[Only protocol-authored contracts and libraries. No interfaces, no vendored libs.]

### Backwards-Compatibility Code

[Only if remnants survived the Step 2c verification checks. Omit the subsection entirely otherwise.]

- `[contract:function]` — [what it belonged to, why retained, that it is not active functionality]

### How It Fits Together

[Start with "The core trick:" — one sentence on the fundamental mechanism. Then 3-5 key
flows as annotated call chains with tree branching, italic annotations on critical steps
(state changes, callback windows, payment verification). Use concrete contract names, not
interface names. Skip governance/admin/oracle flows — Section 2 covers those.]

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as **[Primary]** with **[Secondary]** characteristics

[1-2 sentences on why, from code signals.]

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|

[Only named roles from code. No "Anyone". Never "Semi-trusted" — use "Bounded (reason)".
Capabilities must distinguish instant from timelocked actions and note pause coverage gaps.]

**Adversary Ranking** (by threat level for this protocol type, adjusted by git evidence):

1. **[Adversary]** — [ONE sentence: who they are, why relevant here.]

[3-5 entries. No attack mechanics, no code refs — those live in Key Attack Surfaces.]

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **[Boundary]** — [protection status + the single worst instant action it leaves open + code ref. Max 2 lines.]

### Key Attack Surfaces

[The single authoritative location for surface detail. Sorted by priority score: protocol-type
relevance + git hotspot + fix history + late changes + dangerous area churn. Not alphabetical.
No RISK labels. No mitigation analysis. Blank line between bullets. Hard cap 2 lines each.]

- **[Surface name]** &nbsp;&#91;[X-N](invariants.md#x-n)&#93; — [code ref + the concern + what to trace to confirm or dismiss it.]

### Upgrade Architecture Concerns

[Only if upgradeable contracts exist. Uninitialized implementations, storage gap consistency,
missing upgrade timelock, blast radius of shared contracts, placeholder proxy windows.]

### Protocol-Type Concerns

**As a [Primary type]:**
- [Code ref + technical concern: math precision, curve edge case, share rounding direction.]

[2-3 bullets per type. Skip anything already a Key Attack Surface. Every bullet cites a
specific contract and function — no generic protocol-type advice.]

### Temporal Risk Profile

[Only phases adding NEW information beyond Actors, Attack Surfaces, and Upgrade Architecture.
Skip Steady State. 1-3 bullets per phase, each with a code location and mitigation status.]

### Composability & Dependency Risks

> **[External Name]** — via `[contract:function]`
> - Assumes: [assumptions about return value and behavior]
> - Validates: [checks present, or NONE]
> - Mutability: [Immutable / Upgradeable by X / Governed by X]
> - On failure: [revert / fallback / fail-open]

**Token Assumptions** *(unvalidated only)*:
- [Token type]: assumes [unvalidated assumption] — impact if violated: [consequence]

**Shared State Exposure** *(if applicable)*:
- [Shared pools or oracles, who else shares them, whether this protocol's actions affect others]

---

## 3. Invariants

> ### Full invariant map: **[invariants.md](invariants.md)**
>
> - **[N] Enforced Guards** (`G-1` … `G-N`) — per-call preconditions with check, location, purpose
> - **[N] Single-Contract Invariants** (`I-1` … `I-N`) — Conservation, Bound, Ratio, StateMachine, Temporal
> - **[N] Cross-Contract Invariants** (`X-1` … `X-N`) — caller/callee pairs crossing scope boundaries
> - **[N] Economic Invariants** (`E-1` … `E-N`) — higher-order properties from `I-N` + `X-N`
>
> Every inferred block cites a concrete Δ-pair, guard-lift with write sites, state edge,
> temporal predicate, or NatSpec quote. The **Onchain: No** blocks are the high-signal ones —
> each is simultaneously an invariant and a potential bug. Attack surfaces above cross-link
> directly into the relevant blocks.

[Section 3 is a POINTER, not a catalog. Do NOT duplicate the invariants here.]

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | [Present/Missing] | |
| NatSpec | [~N annotations] | [Coverage notes] |
| Spec/Whitepaper | [Present/Missing] | |
| Inline Comments | [Sparse/Adequate/Thorough] | [Notable gaps] |

[Tag spec-derived claims `(per spec)` versus `(per code)`.]

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | [N] | File scan (always reliable) |
| Test functions | [N] | File scan (always reliable) |
| Line coverage | [N% / Pending / Unavailable — reason] | Coverage tool (requires compilation) |
| Branch coverage | [N% / Pending / Unavailable — reason] | Coverage tool (requires compilation) |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | | |
| Integration | | |
| Fork | | |
| Stateless Fuzz | | |
| Stateful Fuzz (Foundry) | | |
| Stateful Fuzz (Echidna / Medusa) | | |
| Formal Verification (Certora / Halmos / HEVM) | | |

[Always include Unit, Stateless Fuzz, at least one Stateful Fuzz row, and at least one Formal
Verification row even at 0 — their absence is audit-relevant. Consolidate other zero rows into Gaps.]

### Gaps

[Missing categories only, prioritized by audit impact. Never claim "no tests" when files exist.
Reference specific untested functions, not just percentages.]

---

## 6. Developer & Git History

> Analyzed branch: `[branch]` at `[commit]`. Repo shape: [normal_dev / squashed_import] — [one sentence].

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|

[Flag single-developer dominance (>90%), ghost contributors, uneven distribution.]

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | | [Single-dev / Small team / Larger team] |
| Merge commits | [N] of [total] | [Formal review / No merge commits — likely no peer review] |
| Repo age | [first] → [last] | |
| Recent source activity (30d) | | [Active / Quiet / Late burst before audit] |
| Test co-change rate | [N%] | [Measures co-modification, NOT coverage] |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|

### Security-Relevant Commits

[Only commits scoring ≥5. Skip for squashed imports. Score = weighted sum of message intent,
diff structure, security-domain overlap, and change shape. 10+ warrants a manual diff.]

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|

[Internalized libraries with pragma or logic drift are hidden attack surface — upstream
security fixes will not propagate.]

### Technical Debt Markers

| File:Line | Type | Text | Author | Date |
|-----------|------|------|--------|------|

### Security Observations

[4-8 bullets, ONE line each: `**Lead-in** — short fact + file/commit ref.`]

### Cross-Reference Synthesis

[2-4 bullets connecting git signals to Sections 2-3, one line each, using → to compress
cause and effect. Do not restate the findings.]

---

## 7. Static Analysis Summary

| Tool | High | Medium | Low | Notes |
|------|-----:|-------:|----:|-------|
| Slither | | | | [after false-positive triage] |
| Aderyn | | | | |

### Findings Requiring Manual Review

[Tool-flagged items needing human or agent judgment. Route to `slither-analyst`.]

---

## X-Ray Verdict

**[TIER]** — [one sentence justification]

### Readiness Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| Build succeeds | | |
| Tests pass | | |
| Coverage measured on core | | |
| NatSpec on public functions | | |
| Invariants documented | | |
| Known issues listed | | |
| No critical Slither findings | | |
| Architecture documented | | |

### Structural Facts

1. [Verifiable structural fact — nSLOC across N subsystems, N upgradeable contracts, 2 devs wrote N%]

[3-5 items. ONLY measurable facts from Sections 1-7. No security claims, no speculation about
what "could" happen, no bug hypotheses, no attack scenarios. The verdict describes structural
posture — tests, docs, access control, complexity — NOT security. The auditor forms their own
security conclusions.]

### Top Concerns for Auditors

1. [Highest priority — what to look at first]

### Recommended Audit Mode

[Light / Core / Thorough — based on complexity, TVL risk, and readiness tier.]
```

### Verdict Tiers

The tier is the **lowest** level across Tests, Docs, and Access Control. If Code Hygiene shows TODOs in security-critical paths, drop one tier. Absence of TODOs does NOT raise the tier.

| Tier | Tests | Docs | Access Control |
|------|-------|------|----------------|
| **EXPOSED** | 0 test functions found | No NatSpec, no spec | Unclear roles |
| **FRAGILE** | Unit only | Sparse NatSpec | Roles exist, no timelock |
| **ADEQUATE** | Unit + fuzz OR invariant | NatSpec present | Roles plus clear boundaries |
| **HARDENED** | Unit + fuzz + invariant | Plus spec/whitepaper | Plus timelock or multisig |
| **FORTIFIED** | Plus formal verification | Plus thorough inline comments | Plus emergency pause |

The Tests tier is based on test **existence** from the Step 1 file scan, NOT on whether tests pass at runtime. If enumeration found 23 unit test functions, the Tests signal is "unit tests exist" regardless of compilation failures.

Map the tier to a recommended audit mode: EXPOSED or FRAGILE means the codebase is not audit-ready — recommend remediation before engaging, and run Light mode for early feedback. ADEQUATE maps to Core. HARDENED or FORTIFIED maps to Thorough, since the cheap findings are already gone and the remaining bugs are deep.

### entry-points.md Template

```markdown
# Entry Point Map

> [Protocol] | [N] entry points | [N] permissionless | [N] role-gated | [N] admin-only

---

## Protocol Flow Paths

[Order entry points into expected execution flows — the story from deployment to steady state.
Group by actor. Trace backwards from each destination to deployment. Simple arrow chains, no
boxes. Branch with tree characters. Reference earlier flows instead of repeating them. Annotate
non-function preconditions with the left-arrow marker. 15-30 lines total.]

### Setup (Owner)

`initReserve()` → `setLeverager()` → `initVault()` → `setLeverageParams()`

### User Flow

`[owner setup above]` → `Lender.deposit()` → `openPosition()`  ◄── liquidity must exist
                                                    ├─→ `withdraw()`
                                                    └─→ `liquidatePosition()`  ◄── position unhealthy

### Maintenance (Keeper)

`[deposit above]` → [rebalanceInterval passes] → [price in range] → `rebalance()`

---

## Permissionless

[Full detail block per entry point regardless of count. Sorted by value flow: tokens-in first,
tokens-out second, no movement last.]

### `Contract.functionName()`

| Aspect | Detail |
|--------|--------|
| Visibility | [external/public], [nonReentrant if present] |
| Caller | |
| Parameters | [name (user-controlled), name (protocol-derived)] |
| Call chain | `→ Contract.fn() → Contract.fn()` |
| State modified | |
| Value flow | [sender → Vault / Vault → recipient / None] |
| Reentrancy guard | [yes/no] |

---

## Role-Gated

[Group by role, then by value flow. Same detail block. If the protocol has >30 entry points
total, use compact tables here instead of per-function blocks.]

---

## Admin-Only

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|

---

## Initialization

[One-time `initialize()` / `reinitializer()` entry points. Still attackable during deployment.]
```

`entry-points.md` is purely structural. No threat analysis, no invariants, no git history, no test analysis — those belong in the readiness report.

### invariants.md Template

```markdown
# Invariant Map

> [Protocol] | [N] guards | [N] inferred | [N] not enforced onchain

---

## 1. Enforced Guards (Reference)

Per-call preconditions. Heading IDs are anchor targets from x-ray.md attack surfaces.

#### G-1
`require(_fee <= 10)` · `Vault.sol:206` · caps protocol fee so share price cannot be siphoned by an admin fee spike

[Repeat for every guard. Exactly two lines each: the H4 heading, then one body line with three
middot-separated fields — verbatim predicate in backticks, file:line in backticks, purpose prose.
The purpose must explain WHY the guard exists / which invariant or trust boundary it enforces,
not restate what the predicate checks. Blank line between guards, no horizontal rules.]

[NatSpec-stated global invariants do NOT belong here — they route to §2/§3/§4 by shape.]

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · Onchain: **Yes**

> totalSupply == Σ balanceOf[user]

**Derivation** — Δ-pair: `Vault.sol:142` ↔ `Vault.sol:143`; confirmed at all 4 write sites of `totalSupply`

**If violated** — [consequence]

---

[Repeat for every inferred invariant. Fields separated by blank lines. Category and Onchain
status sit between the heading and the claim so status is scannable.]

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

Onchain: **No**

> [what the caller assumes about the callee's return value or state]

**Caller side** — `Caller.sol:LN` — [how the value is used]

**Callee side** — `Callee.sol:LN` — [write sites that could break the assumption]

**If violated** — [consequence]

---

## 4. Economic Invariants

#### E-1

Onchain: **No**

> [economic property]

**Follows from** — `I-4` + `X-1`

**If violated** — [consequence]
```

Rules for `invariants.md`:

- **Heading blocks, never tables.** H4 headings produce the slug anchors that cross-file links resolve. Inline `<a id>` anchors inside table cells do not work cross-file.
- **Derivation discipline.** Every inferred block cites exactly one of: `Δ-pair: Contract.sol:Lx ↔ Contract.sol:Ly`; `guard-lift: <verbatim guard> + <write-site enumeration>` (a single-callsite guard is not a valid lift); `edge: State@Lx → State@Ly`; `temporal: <verbatim check>`; `NatSpec: Contract.sol:LN — "<verbatim comment>"`. Blocks that cannot cite one are dropped. No "implied by semantics."
- **Onchain field is Yes or No only.** If partially enforced, split into two blocks — one for what IS enforced, one for the gap. Any guard-lift block with an unguarded write site is No.
- **Cross-contract blocks cite both sides**, and both sides must be inside the scope files.
- **Economic blocks derive from specific IDs** in `Follows from`.
- No cap on block count. Factual only — no threat analysis.

### Verification Rules (apply while writing Section 2)

- **Permissionless entry points** — use only the grep-verified, body-checked list from Step 2b. Subagent summaries are not the source of truth.
- **Security claims** — before writing that a security check is missing, incomplete, or bypassable, trace the actual data flow: identify all write sites of the variable via Grep, then confirm the claim against those write sites. If you cannot verify, qualify with "could not confirm" rather than stating it as fact.
- **Cross-links** — verify each `invariants.md#...` fragment matches a heading that actually exists in the file you just wrote, and that the fragment is lowercase.

### Terminal Verdict

After all files are written and cleanup is done, read the `## X-Ray Verdict` section from the generated `x-ray/x-ray.md` and print it verbatim to the terminal. Do NOT paraphrase, summarize, or rewrite — copy the exact tier, justification, and structural facts as they appear in the file.

---

## Step 9: Integration with EVM Cortex Agents

X-Ray feeds directly into the EVM Cortex audit pipeline:

| Agent | Receives from X-Ray | Uses It For |
|-------|---------------------|-------------|
| `scout` | Request to explore codebase | File discovery before X-Ray runs; Path B subsystem readers |
| `audit-orchestrator` | Verdict tier + full report | Scoping audit mode, routing depth agents |
| `invariant-analyst` | `invariants.md` with `I-N` / `X-N` / `E-N` IDs | Deepening the invariant set, especially `Onchain: No` blocks |
| `invariant-tester` | Invariant IDs + entry points | Foundry invariant suites named after the IDs |
| `access-control-reviewer` | Actors table + Step 2d centralization analysis | Privilege escalation and centralization review |
| `oracle-analyst` | Composability dependency map | Oracle staleness, deviation, and sequencer checks |
| `mev-analyst` | Permissionless entry points + value flows | Front-running and sandwich exposure |
| `slither-analyst` | Static analysis output + scope table | Triaging findings against X-Ray context |
| `depth-state-trace` | Entry points + delta writes | Tracing state mutations through high-risk paths |
| `depth-token-flow` | Fund flow functions + token assumption gaps | Verifying token accounting correctness |
| `depth-edge-case` | Entry points + invariants | Enumerating boundary conditions |
| `depth-external` | External call classification | Reentrancy and callback risk analysis |
| `storage-layout-analyst` | Upgrade Architecture Concerns | Storage gap and collision verification |
| `code-reviewer` | Scope table + architecture diagram | Focused review with full context |
| `poc-writer` | `Onchain: No` invariant blocks + attack surfaces | Exploit PoCs that falsify a specific invariant ID |
| `security-verifier` | PoC candidates + severity inputs | Fork-test verification |
| `scribe` | Full X-Ray report | Generating the final audit report |

### Orchestration Example

```
1. scout                → explores codebase, identifies src layout
2. xray-pre-audit       → generates x-ray/ folder (report, entry points, invariants, diagram)
3. audit-orchestrator   → reads verdict tier, picks Light/Core/Thorough
   ├── Onchain:No conservation blocks   → depth-token-flow
   ├── delta writes + entry points      → depth-state-trace
   ├── boundary invariants              → depth-edge-case
   ├── external call classification     → depth-external
   ├── Actors + centralization analysis → access-control-reviewer
   └── dependency map                   → oracle-analyst
4. invariant-tester → tests named for I-N / X-N IDs
5. poc-writer       → PoCs falsifying specific Onchain:No blocks
6. security-verifier→ fork-verifies each PoC
7. scribe           → final report, invariant IDs carried through
```

---

## Step 10: Constraints & Quality Standards

### Hard Constraints

- **Under 500 lines** for `x-ray.md`. Protect the threat model, invariant pointer, test gaps, git analysis, and verdict; compress other sections if needed. Detail goes to `entry-points.md` and `invariants.md`.
- **No fabrication.** Never invent contract addresses, function signatures, coverage numbers, or findings. If a determination cannot be made from the code, write "could not determine from available source" with the specific reason.
- **Fully autonomous.** No user interaction during analysis.
- **Verify before stating.** Every security claim references specific code. Never assert "function X is safe" without checking.
- **Commit- and branch-pinned.** Record the exact commit hash and branch at the top of every generated file. The report is valid only for that commit on that branch.
- **Vendor-neutral.** Never reference audit platforms, contest rules, or bounty program framing.
- **Single pass.** No partial outputs.
- **Bullet brevity.** One tight sentence per bullet, ideally one line, at most two. Do not restate what the `file:line` reference already shows. Code references carry the evidence; prose must not duplicate them.

### Quality Standards

- Entry points must be exhaustive. A missed entry point is a missed attack surface.
- Every invariant block carries a concrete derivation and an explicit Yes/No Onchain verdict.
- At least 70% of attack surfaces on a non-trivial protocol should cross-link to an invariant ID. A much lower rate means the invariant walk was too shallow.
- The threat model must be specific to THIS protocol, not generic boilerplate. Every bullet cites a contract and function.
- Coverage gaps reference specific functions, not just percentages.
- Contracts are always grouped by subsystem in the scope table.

### What X-Ray Does NOT Do

- **Line-by-line code review** — that is the breadth/depth scan's job
- **Exploit path construction** — surfaces are investigation pointers; the auditor builds the attack
- **PoC construction** — that is `poc-writer`'s job
- **Formal verification** — that is `formal-verifier`'s job
- **Fix recommendations** — X-Ray identifies; other agents remediate
- **Deployment verification** — that is `protocol-qa`'s job

---

## Pre-Audit Readiness Checklist

Run this checklist to determine whether a codebase is ready for audit. X-Ray populates the answers, and the results drive the verdict tier.

### Build & Test Infrastructure
- [ ] `forge build` succeeds with zero warnings
- [ ] `forge test` passes — all tests green
- [ ] `forge coverage` runs without error (and the number in the report was actually produced)
- [ ] `foundry.toml` properly configured (src, test, script paths)
- [ ] Dependencies pinned to specific versions, no floating refs
- [ ] No modified or forked third-party code without documentation

### Code Quality
- [ ] NatSpec on all external/public functions (`@notice`, `@param`, `@return`)
- [ ] Custom errors used, no `require` strings
- [ ] Named imports only, no wildcard imports
- [ ] Consistent Solidity version across all files
- [ ] `forge fmt` produces no diff
- [ ] No TODO/FIXME/HACK comments in production code

### Security Posture
- [ ] Checks-effects-interactions pattern followed
- [ ] `ReentrancyGuard` on functions with external calls
- [ ] `SafeERC20` used for all token interactions
- [ ] Access control on all state-changing functions
- [ ] Initializers protected against re-initialization
- [ ] No hardcoded addresses in source — use immutables or constructor args
- [ ] Events emitted for all state changes
- [ ] Pause coverage complete — every fund-touching function that should be pausable is

### Documentation
- [ ] Architecture document exists
- [ ] Protocol invariants documented, ideally with stable IDs
- [ ] Known issues and accepted risks listed
- [ ] External dependency trust assumptions stated
- [ ] Deployment plan documented
- [ ] Admin capabilities enumerated, distinguishing instant from timelocked actions

### Static Analysis
- [ ] Slither run with findings triaged
- [ ] All High-severity Slither findings resolved or documented
- [ ] Aderyn run reviewed, if available

### Test Coverage
- [ ] Core contracts above 90% branch coverage
- [ ] Periphery contracts above 80% branch coverage
- [ ] Edge cases tested: zero amounts, max values, first and last operations
- [ ] Fuzz tests present for math-heavy functions
- [ ] Invariant tests present for core accounting
- [ ] Fork tests present for external integrations

### Git Hygiene
- [ ] Audit scope pinned to a specific commit on a named branch
- [ ] No uncommitted changes in scope
- [ ] Branch up to date with main
- [ ] CI passes on the audit commit
- [ ] No burst of unreviewed commits immediately before the audit window

---

## Output File Structure

After X-Ray completes, the project contains:

```
project/
├── x-ray/
│   ├── x-ray.md           # Main readiness report (< 500 lines)
│   ├── entry-points.md    # Flow paths + full entry point classification
│   ├── invariants.md      # Invariant catalog with stable G/I/X/E IDs
│   └── architecture.svg   # Validated architecture diagram
├── src/                   # Source contracts (unchanged)
├── test/                  # Test suite (unchanged)
└── foundry.toml           # Build config (unchanged)
```

`architecture.json` and any temporary git analysis output are removed at cleanup. All kept files are generated fresh on each run and are gitignored by default. To preserve a snapshot, commit the `x-ray/` folder with the audit commit hash in the commit message.
