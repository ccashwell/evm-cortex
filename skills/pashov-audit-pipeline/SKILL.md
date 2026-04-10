---
name: pashov-audit-pipeline
description: Use when performing a comprehensive smart contract security audit. Implements the Pashov Audit Group's parallelized 8-agent methodology covering vector scanning, math precision, access control, economic security, execution tracing, invariant analysis, periphery review, and first-principles reasoning. Produces deduplicated, severity-classified findings with PoC verification.
---

# Pashov Audit Pipeline

## Overview

This methodology runs 8 specialized security agents in parallel against the same codebase, then deduplicates and validates findings into a single report. Each agent examines the code through a distinct lens — attack vectors, math precision, access control, economics, execution flow, invariants, periphery integration, and first-principles reasoning. Parallel execution prevents tunnel vision and surfaces issues that single-pass reviews miss.

Adapted from the Pashov Audit Group's open-source approach (`github.com/pashov/skills`) for use with the EVM Cortex agent squad.

### When to Use

- Full security audit of a protocol before mainnet deployment
- Re-audit after significant code changes or new feature additions
- Pre-merge security review of high-risk PRs touching core accounting or token logic
- Competitive audit participation where thoroughness and finding volume matter

### When NOT to Use

- Quick sanity check on a single function — use `audit-breadth-scan` instead
- Static analysis triage — use `slither-analysis` or `aderyn-analysis`
- Gas-only review — use `gas-optimizer`
- Code quality review without security focus — use `code-reviewer`

---

## Phase 1: Scope Preparation

Before launching agents, define the audit perimeter precisely. Ambiguous scope wastes agent cycles on out-of-scope code.

### 1.1 File Discovery

```bash
find src/ -name "*.sol" \
  -not -path "*/interfaces/*" \
  -not -path "*/lib/*" \
  -not -path "*/mocks/*" \
  -not -path "*/test/*" \
  -not -name "*.t.sol" \
  -not -name "*Test*.sol" \
  -not -name "*Mock*.sol" \
  | sort
```

For Foundry projects, also exclude script directories:

```bash
find src/ -name "*.sol" \
  -not -path "*/interfaces/*" \
  -not -path "*/lib/*" \
  -not -path "*/mocks/*" \
  -not -path "*/test/*" \
  -not -path "*/script/*" \
  -not -name "*.t.sol" \
  -not -name "*.s.sol" \
  -not -name "*Test*.sol" \
  -not -name "*Mock*.sol" \
  | sort
```

### 1.2 Scope Table

Build a scope table with SLOC counts and complexity ratings:

```markdown
## Audit Scope

| File | nSLOC | Complexity | Description |
|------|-------|------------|-------------|
| src/Pool.sol | 342 | High | Core AMM pool with concentrated liquidity |
| src/Router.sol | 218 | Medium | Multicall swap router with deadline checks |
| src/Oracle.sol | 87 | Medium | TWAP oracle with cardinality management |
| src/PositionManager.sol | 156 | High | NFT position manager with fee collection |
| src/libraries/TickMath.sol | 94 | High | Q64.96 sqrt price / tick conversions |
| src/libraries/SwapMath.sol | 67 | High | Per-tick swap step computation |
| **Total** | **964** | | |

### Out of Scope
- OpenZeppelin imports (v5.1.0) — audited separately
- Uniswap V4 core (v4.0.0) — audited by third parties
- Test files, scripts, deployment infrastructure
- Frontend / offchain keepers
```

### 1.3 Source Bundle

Concatenate all in-scope files into a single document with file path headers. Each agent receives this identical bundle.

```markdown
### src/Pool.sol
\`\`\`solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// ... full file contents ...
\`\`\`

### src/Router.sol
\`\`\`solidity
// ... full file contents ...
\`\`\`
```

### 1.4 Context Package

Alongside the source bundle, provide each agent with:

1. **Protocol README** — high-level description of what the protocol does
2. **Known issues** — bugs the team already knows about (avoid duplicate reports)
3. **Design decisions** — intentional tradeoffs the team has documented
4. **Deployment context** — target chains, expected gas costs, upgrade strategy
5. **External dependencies** — oracles, tokens, protocols the code integrates with
6. **Prior audit reports** — findings from previous audits and their resolution status

### 1.5 Pre-flight Checks

```bash
# Verify the project builds clean
forge build --deny-warnings

# Run existing tests to establish baseline
forge test --summary

# Run Slither for automated baseline
slither . --filter-paths "test|script|node_modules" --json slither-report.json

# Generate dependency tree
forge tree > dependency-tree.txt

# SLOC metrics
find src/ -name "*.sol" -not -path "*/test/*" -not -path "*/script/*" \
  | xargs wc -l | tail -1
```

---

## Phase 2: The Eight Security Agents

Each agent receives the identical source bundle and context package. All 8 launch in parallel. Each agent works independently — no inter-agent communication during analysis.

### Agent 1: Vector Scan Agent

**EVM Cortex mapping:** `audit-orchestrator` + `depth-edge-case`

**Focus:** Systematically check known vulnerability patterns against the codebase. This agent works from a catalog, not from intuition.

**Instructions to agent:**

You are a vulnerability scanner. Check the following attack vector catalog against every function in the codebase. For each vector, determine if the code is vulnerable, mitigated, or not applicable.

#### Attack Vector Catalog

**Reentrancy**
- Cross-function reentrancy: state read in function A, modified in function B, exploitable via callback between them
- Cross-contract reentrancy: contract A reads state from contract B, callback modifies B before A finishes
- Read-only reentrancy: view function returns stale state during an active call that hasn't updated yet
- ERC-777 `tokensReceived` hook reentrancy
- ERC-721 `onERC721Received` callback reentrancy
- Mitigation check: `nonReentrant` on every function with external calls or state reads after external calls

**Flash Loans**
- Can any function be called within a flash loan callback that breaks protocol assumptions?
- Does the protocol rely on token balances that could be inflated within a flash loan?
- Can governance votes be flash-loan manipulated?
- Can oracle prices be flash-loan manipulated (spot price vs TWAP)?

**Signature Vulnerabilities**
- Missing nonce in signed messages → replay across transactions
- Missing chain ID → replay across chains
- Missing contract address → replay across deployments
- `ecrecover` returning `address(0)` treated as valid
- Signature malleability (EIP-2 `s` value check)
- Missing deadline on permits and signed orders
- EIP-712 domain separator correctness

**Oracle Manipulation**
- Spot price used instead of TWAP
- Single oracle without fallback
- Missing staleness check on Chainlink feeds
- Missing sequencer uptime check for L2 deployments
- Decimal conversion errors between oracle and protocol

**Front-running / MEV**
- Sandwich-attackable swaps without slippage protection
- Missing deadline parameters on time-sensitive operations
- Predictable randomness exploitable by miners/validators
- Commit-reveal schemes with insufficient hiding

**Griefing**
- Can an attacker force reverts on other users' transactions?
- Can dust deposits/withdrawals block legitimate operations?
- Can an attacker inflate gas costs for other users (storage writes in loops)?
- Can an attacker front-run initialization or first-deposit to grief the protocol?

**Denial of Service**
- Unbounded loops over user-controlled arrays
- External calls in loops (any single revert blocks the entire batch)
- Block gas limit reachable via storage growth
- Self-destruct into contract to force ETH balance manipulation

**Precision / Rounding**
- Division before multiplication causing truncation
- Rounding direction benefiting attacker over protocol
- Loss of precision in fee calculations accumulating over time
- Share price manipulation via donation (ERC-4626 inflation)

#### Output Format

For each finding, classify:
- **Vulnerable**: Complete exploit path identified → produce FINDING
- **Suspicious**: Pattern present but exploit path unclear → produce LEAD
- **Mitigated**: Pattern present but correctly mitigated → note in appendix
- **N/A**: Pattern not applicable to this codebase → skip

---

### Agent 2: Math & Precision Agent

**EVM Cortex mapping:** `depth-token-flow`

**Focus:** Numerical correctness. Every arithmetic operation is suspect until proven safe.

**Instructions to agent:**

You are a math auditor. Trace every arithmetic operation in the codebase and verify correctness.

#### Checklist

**Overflow / Underflow**
- Solidity 0.8+ has built-in checks, but `unchecked` blocks bypass them — audit every `unchecked` block
- Casting between types: `uint256` to `uint128`, `int256` to `uint256` — check for truncation and sign loss
- `type(uint256).max` as sentinel value — does arithmetic with it overflow?

**Division and Multiplication Ordering**
- Identify every `a * b / c` vs `a / c * b` pattern
- Verify multiplication happens before division to minimize truncation
- Check for division by zero when denominators come from user input or state

**Rounding Direction**
- Protocol fees: round UP (protocol collects at least the intended fee)
- Share-to-asset conversion on deposit: round DOWN (fewer shares minted)
- Asset-to-share conversion on withdrawal: round UP (more shares burned)
- Liquidation bonus: round DOWN (liquidator gets at most the intended bonus)
- For each rounding operation, verify the direction favors the protocol, not the user

**Fixed-Point Arithmetic**
- WAD (1e18): verify multiply-then-divide pattern `(a * b) / 1e18`
- RAY (1e27): same pattern with 1e27
- Q64.96 / Q128.128: verify bit shift operations are correct
- Cross-system conversions: WAD to RAY, Q96 to WAD — check for precision loss

**ERC-4626 Share Accounting**
- First depositor inflation attack: virtual shares/assets offset present?
- `convertToShares` and `convertToAssets` rounding consistency
- `maxDeposit`, `maxMint`, `maxWithdraw`, `maxRedeem` return correct limits
- `previewDeposit` ≤ actual `deposit` shares (favorable rounding direction)
- `previewWithdraw` ≥ actual `withdraw` shares burned

**Fee Calculations**
- Basis point math: `amount * feeBps / 10_000` — check truncation on small amounts
- Compound fee accumulation over time — does precision loss accumulate?
- Fee-on-transfer tokens: actual received ≠ amount parameter

**Decimal Handling**
- USDC (6), WBTC (8), most ERC-20 (18) — never assume 18
- Scaling factors between different-decimal tokens
- Oracle price feeds: Chainlink USD feeds use 8 decimals, ETH feeds use 18

---

### Agent 3: Access Control Agent

**EVM Cortex mapping:** `access-control-reviewer`

**Focus:** Permission model correctness. Every state-changing function must have the right guard.

**Instructions to agent:**

You are an access control auditor. Map the entire permission model and find gaps.

#### Analysis Steps

**1. Build the Role Map**

```markdown
| Role | Holder(s) | Powers | Risk |
|------|-----------|--------|------|
| owner | deployer EOA | upgrade, pause, set fees | Critical |
| admin | multisig | add strategies, set parameters | High |
| keeper | bot address | harvest, rebalance | Medium |
| user | anyone | deposit, withdraw | Low |
```

**2. Check Every External/Public State-Changing Function**

For each function, verify:
- Is the access modifier correct? (onlyOwner, onlyRole, or intentionally public)
- Can the function be called in an unintended state? (before initialization, after pause)
- Are there privilege escalation paths? (user → admin, admin → owner)

**3. Specific Checks**

- Missing access control on state-changing functions — the most common critical finding
- `initialize()` callable by anyone after deployment (missing `initializer` modifier)
- `initialize()` callable multiple times (missing `initializer` or manual flag)
- Two-step ownership transfer: is it used? Single-step `transferOwnership` risks fat-finger loss
- Default admin role in AccessControl: is `DEFAULT_ADMIN_ROLE` properly managed?
- Time-lock on critical parameter changes (fee changes, strategy changes)
- Self-destruct or `delegatecall` to arbitrary targets accessible to non-owners
- Function selector collision in proxy/diamond patterns
- Missing `whenNotPaused` on functions that should respect pause state
- Missing `nonReentrant` on functions callable by untrusted addresses

**4. Upgrade Safety**

- Who can trigger upgrades? Is it behind a timelock?
- Can the implementation be set to a malicious contract?
- Are there storage layout collisions between proxy and implementation?
- Is `_disableInitializers()` called in the constructor of the implementation?

---

### Agent 4: Economic Security Agent

**EVM Cortex mapping:** `mev-analyst` + `oracle-analyst`

**Focus:** Economic attack vectors. Think like a well-funded attacker with flash loans.

**Instructions to agent:**

You are an economic security analyst. Assume the attacker has unlimited flash loan capital and can execute multiple transactions atomically.

#### Analysis Framework

**Flash Loan Attack Surfaces**
- Identify every function that reads token balances, oracle prices, or pool reserves
- For each: can a flash loan temporarily manipulate the value read?
- Trace the impact: does manipulated value lead to favorable rates, incorrect liquidations, or governance capture?

**MEV Extraction**
- Sandwich attacks: identify swap-like operations without slippage protection
- Front-running: can an attacker observe a pending tx and profit by executing first?
- Back-running: can an attacker profit by executing immediately after a state change?
- Just-in-time (JIT) liquidity: can LPs add/remove around known large swaps?

**Arbitrage-Exploitable Pricing**
- Does the protocol use a pricing mechanism that can diverge from market?
- Can an attacker profitably arbitrage between the protocol's price and external markets?
- Is the arbitrage bounded (acceptable) or unbounded (vulnerability)?

**Reward / Emission Gaming**
- Can a user repeatedly stake/unstake around reward distribution to claim outsized rewards?
- Can reward rate be manipulated by flashloan-inflating the staking pool?
- Are rewards calculated on a per-block basis that can be gamed by precise timing?

**Liquidation Mechanics**
- Can self-liquidation be profitable?
- Can an attacker manipulate the price feed to trigger unjust liquidations?
- Is there a liquidation cascade risk where one liquidation triggers others?
- Is the liquidation bonus set correctly to incentivize liquidators without overpaying?

**Token Economic Edge Cases**
- Fee-on-transfer tokens: does the protocol account for received < sent?
- Rebasing tokens: does the protocol track shares or balances?
- Tokens with callbacks (ERC-777): reentrancy via token transfer hooks?
- Approval race condition: does the protocol use `safeIncreaseAllowance`?
- Tokens with blocklists (USDC): what happens when a core address is blocklisted?
- Token upgrade risk: can the token implementation change under the protocol?

**Governance Attacks**
- Flash loan governance: can voting power be borrowed?
- Proposal griefing: can an attacker prevent legitimate proposals?
- Execution delay bypass: can timelock be circumvented?
- Vote buying via dark pools or lending markets

---

### Agent 5: Execution Trace Agent

**EVM Cortex mapping:** `depth-state-trace`

**Focus:** Control flow and state transition correctness. Trace every execution path.

**Instructions to agent:**

You are an execution flow analyst. Trace every state-changing function from entry to exit, tracking state mutations and external calls.

#### Methodology

**For each state-changing function, produce a trace:**

```markdown
## Trace: Contract.function(params)

### Preconditions
- State variables read: [list]
- msg.sender requirements: [access control]
- Parameter validation: [checks]

### Execution Steps
1. [Check] require/revert condition
2. [Effect] state variable mutation
3. [Effect] event emission
4. [Interaction] external call to X
5. [Effect] post-call state update ← DANGEROUS if after external call

### Postconditions
- State variables modified: [list with before/after values]
- External calls made: [list with parameters]
- Events emitted: [list]
- Return value: [value]
```

**State Machine Validation**
- Enumerate all valid states (e.g., Uninitialized → Active → Paused → Shutdown)
- For each function, verify it only executes in valid states
- Check that state transitions follow the declared state machine
- Look for missing state checks that allow invalid transitions

**Cross-Contract Call Analysis**
- For every external call, trace what the callee can do
- Can the callee call back into the caller? (reentrancy)
- Can the callee revert, and does the caller handle it correctly?
- Does the caller assume the callee returns truthful data?
- Are there ordering dependencies between multiple external calls?

**Return Value Handling**
- Every `external` call: is the return value checked?
- Low-level `call` / `delegatecall` / `staticcall`: is success checked?
- `try/catch` blocks: does the catch path handle all failure modes?
- IERC20 `transfer`/`approve`: use `SafeERC20` wrappers?

**Block Context Dependencies**
- `block.timestamp`: can it be manipulated ±15 seconds by validators?
- `block.number`: is it used as a time proxy? (unreliable across L2s)
- `block.basefee`: can it be manipulated?
- `tx.origin`: never use for authorization (phishing via intermediary contract)
- `msg.value`: checked in non-payable functions? Checked exactly once in payable multicalls?

**Gas Consumption Analysis**
- Unbounded loops: can an attacker grow a storage array to make iteration exceed block gas limit?
- External calls in loops: can a single revert DoS the entire batch?
- Storage writes in loops: linear gas cost growth — is there a cap?

---

### Agent 6: Invariant Agent

**EVM Cortex mapping:** `invariant-analyst`

**Focus:** Identify and verify protocol invariants that must hold across ALL operations.

**Instructions to agent:**

You are an invariant analyst. Your job is to identify every property that must always be true, then verify each one holds across all code paths.

#### Invariant Discovery

**Balance Invariants**
- Total token balance ≥ sum of all user claims
- Total supply of shares = sum of all holder balances
- Protocol reserves ≥ outstanding liabilities
- Fee accumulator ≤ total fees collected

**Accounting Invariants**
- For every deposit, shares minted correspond to assets received
- For every withdrawal, assets returned correspond to shares burned
- Total assets = idle balance + deployed balance + unclaimed fees
- No token can be created from nothing or destroyed silently

**State Invariants**
- After initialization, core addresses are non-zero
- Paused state prevents all user-facing operations
- After shutdown, no new deposits are possible
- Fee parameters stay within declared bounds (0 ≤ fee ≤ MAX_FEE)

**Ordering Invariants**
- Timestamps of sequential operations are non-decreasing
- Queue entries are processed in FIFO order
- Price observations are stored in chronological order

**Monotonicity Invariants**
- Total deposits counter only increases
- Nonces only increment
- Share price never decreases under normal operations (no loss events)

#### Invariant Verification

For each identified invariant:

```markdown
## Invariant: [description]

### Formal Statement
For all valid states S and all operations O: property P holds in apply(O, S)

### Code Paths That Could Violate
1. [function] — modifies relevant state variables
2. [function] — external call could change state
3. [function] — edge case at zero/max values

### Verification
- Path 1: [holds | violated | conditional]
- Path 2: [holds | violated | conditional]
- Path 3: [holds | violated | conditional]

### Missing Checks
- [Any code location where the invariant should be enforced but isn't]
```

#### Invariant Testing Recommendations

For confirmed invariants, recommend Foundry invariant tests:

```solidity
function invariant_totalSupplyMatchesBalances() public view {
    uint256 sum;
    for (uint256 i; i < actors.length; i++) {
        sum += vault.balanceOf(actors[i]);
    }
    assertEq(vault.totalSupply(), sum);
}

function invariant_assetsGeqLiabilities() public view {
    uint256 assets = token.balanceOf(address(vault)) + strategy.totalDeployed();
    uint256 liabilities = vault.convertToAssets(vault.totalSupply());
    assertGe(assets, liabilities);
}
```

---

### Agent 7: Periphery Agent

**EVM Cortex mapping:** `depth-external`

**Focus:** Integration boundaries, external dependencies, and upgrade safety.

**Instructions to agent:**

You are a periphery and integration analyst. Focus on everything that crosses the contract boundary.

#### External Contract Interactions

**Oracle Dependencies**
- Which oracles does the protocol use? (Chainlink, Uniswap TWAP, custom)
- Staleness protection: is `updatedAt` checked against a maximum age?
- Price boundaries: can the oracle return 0 or negative values? Is it handled?
- Fallback mechanism: what happens if the primary oracle fails?
- L2 sequencer uptime: does the protocol check sequencer status on L2?
- Decimal normalization: does the protocol correctly scale oracle prices?

**Token Integration**
- ERC-20 compliance: uses `SafeERC20` for all transfers?
- Non-standard tokens: fee-on-transfer, rebasing, blocklist, pausable
- Token decimals: never hardcoded, always read from `decimals()`?
- Infinite approval risk: does the protocol approve max amounts to external contracts?
- Approval to upgradeable contracts: token behavior could change

**Cross-Chain**
- Bridge message validation: are source chain and sender verified?
- Message replay protection: can the same message be executed twice?
- Finality assumptions: does the protocol wait for sufficient confirmations?
- Gas limit for destination execution: is it sufficient for all code paths?

**Upgrade Safety**
- Storage layout: are new state variables appended at the end of storage?
- Storage gaps: do inherited contracts use `__gap` arrays?
- Initializer chain: does every new version call its parent initializer?
- `_disableInitializers()` in implementation constructor?
- Function selector collisions between proxy admin and implementation?
- Immutable values: can they change across upgrades? (they reset)

**Library Dependencies**
- OpenZeppelin version: is it the latest stable? Any known vulnerabilities?
- Solmate vs OpenZeppelin: are they mixed? (different assumptions)
- Custom libraries: are they tested as thoroughly as core contracts?

**ABI Encoding/Decoding**
- `abi.encodePacked` collision risk with variable-length types
- `abi.decode` with wrong types: silent corruption or revert?
- Calldata vs memory: correct data location for external calls?

---

### Agent 8: First Principles Agent

**EVM Cortex mapping:** `sleuth`

**Focus:** Forget the checklist. Reason from scratch about what could go wrong.

**Instructions to agent:**

You are a first-principles security researcher. Do NOT use a checklist. Instead, answer these questions by reading the code carefully:

#### Core Questions

1. **What is the worst thing that could happen to this protocol?**
   - Total loss of user funds
   - Permanent bricking of the contract
   - Unauthorized minting / infinite token supply
   - Loss of admin access

2. **What are the trust assumptions?**
   - Who is trusted? (owner, admin, keeper, oracle, external protocols)
   - What happens if each trusted party turns malicious?
   - What happens if each trusted party disappears?
   - Are trust assumptions documented? Do they match the code?

3. **What is unique about this codebase?**
   - Novel mechanisms not found in standard DeFi
   - Unusual patterns that deviate from OpenZeppelin / Solmate norms
   - Complexity hotspots where multiple concerns intersect
   - "Clever" code that optimizes readability away

4. **What composability risks exist?**
   - How does this protocol behave as a building block in other protocols?
   - Can flash loans be used to atomically exploit multi-protocol interactions?
   - What if a protocol this one depends on gets exploited?
   - What if a token this protocol holds upgrades its implementation?

5. **What are the lifecycle edge cases?**
   - Deployment: can initialization be front-run?
   - Migration: can the transition from V1 to V2 be exploited?
   - Emergency shutdown: can funds be recovered? By whom?
   - Sunset: what happens when the protocol is abandoned?

6. **What did the other agents probably miss?**
   - Novel attack vectors not in standard catalogs
   - Business logic errors that aren't classic "vulnerabilities"
   - Incorrect assumptions about external protocol behavior
   - Off-by-one errors in time-based logic
   - Race conditions between governance actions and user operations

---

## Phase 3: Finding Format

Every agent produces findings in a uniform format for downstream deduplication.

### FINDING (confidence ≥ 75)

Complete exploit chain identified. Could be turned into a Foundry PoC.

```markdown
## [FINDING] Title

**Severity:** Critical | High | Medium | Low
**Confidence:** 75-100
**Category:** reentrancy | precision-loss | access-control | economic | logic | ...
**group_key:** ContractName | functionName | bug-class

### Description
Precise description of the vulnerability. Reference specific lines and state variables.

### Impact
What damage can an attacker cause? Quantify if possible (e.g., "drain all USDC from the vault").

### Proof of Concept
Step-by-step exploit path:
1. Attacker calls X with parameters Y
2. State changes to Z
3. Callback triggers, allowing...
4. Attacker profits by...

### Recommended Fix
Specific code change with before/after. Verify the fix doesn't introduce new issues.
```

### LEAD (confidence < 75)

Suspicious pattern that needs manual verification or additional context.

```markdown
## [LEAD] Title

**Severity:** Estimated severity if confirmed
**Confidence:** 0-74
**Category:** [bug class]
**group_key:** ContractName | functionName | bug-class

### Observation
What looks suspicious.

### Concern
What could go wrong if the suspicion is correct.

### Verification Needed
What specific check would confirm or refute this lead.
```

---

## Phase 4: Deduplication & Validation

After all 8 agents return their findings, deduplicate and validate.

### 4.1 Grouping

Group findings by `group_key` (Contract | function | bug-class). Findings from different agents targeting the same location and bug class are candidates for merging.

### 4.2 Merge Rules

1. **Exact duplicates**: same contract, function, and bug class → merge, keep the version with the best PoC
2. **Overlapping findings**: same root cause but different exploit paths → merge into one finding, list all exploit paths
3. **Related but distinct**: same function but different bug classes → keep separate
4. **Chain findings**: finding A's output feeds into finding B's precondition → create composite finding with combined severity

### 4.3 Agent Attribution

After merging, annotate each finding with `[agents: N/8]` showing how many agents independently flagged the issue. Higher agent count increases confidence.

### 4.4 Lead Promotion

Promote LEAD → FINDING when:
- A complete exploit chain is traced through the source code, OR
- 2+ agents independently flagged the same issue (convergent evidence)

Do NOT promote when:
- A concrete code-level refutation exists (specific mitigation identified)
- The concern relies on deployer-intent reasoning ("the admin wouldn't do that")
- The only evidence is a pattern match without a traced exploit path

### 4.5 Gate Evaluation

Run each FINDING through severity validation:

| Gate | Question |
|------|----------|
| **Completeness** | Is the attack path fully traced from entry to impact? |
| **Preconditions** | Are preconditions realistic? (not "attacker controls admin key") |
| **Impact** | Is impact correctly classified per the severity matrix? |
| **Fix quality** | Does the recommended fix resolve the issue without side effects? |
| **Uniqueness** | Is this finding genuinely distinct from other findings? |

---

## Phase 5: Severity Classification

### Severity Matrix

| Severity | Impact | Likelihood | Examples |
|----------|--------|------------|----------|
| **Critical** | Direct loss of funds, protocol insolvency, permanent bricking | Highly likely, low barrier to exploit | Unrestricted `withdraw`, oracle manipulation draining pool, infinite mint |
| **High** | Significant fund loss (>1% TVL) or protocol disruption | Likely under realistic conditions | Reentrancy draining partial funds, incorrect liquidation thresholds |
| **Medium** | Limited fund loss or degraded functionality | Possible but requires specific conditions | Rounding errors accumulating over time, griefing specific users |
| **Low** | Minimal impact, theoretical | Unlikely or requires significant preconditions | Front-running informational transactions, minor gas inefficiency in edge case |
| **Informational** | No direct security impact | N/A — best practice | Missing NatSpec, unused imports, inconsistent naming |

### Classification Rules

- Severity = Impact × Likelihood
- If impact is Critical but likelihood requires admin compromise → High (not Critical)
- If impact is Low but likelihood is near-certain → Medium
- When in doubt, err toward higher severity — the protocol team can downgrade
- Fund loss always trumps other impact categories

---

## Phase 6: Fix Verification

For findings with confidence ≥ 80, verify the recommended fix.

### 6.1 Fix Trace

```markdown
## Fix Verification: [Finding ID]

### Original Attack Path
1. [step 1]
2. [step 2]
3. [step 3]

### Proposed Fix
[specific code change]

### Fix Trace
1. [step 1] — still possible
2. [step 2] — BLOCKED by fix at [line]
3. Attack path terminated ✓

### Side Effect Check
- [ ] Fix does not introduce new DoS vectors
- [ ] Fix does not break existing functionality
- [ ] Fix does not introduce new reentrancy paths
- [ ] Fix does not break invariants identified by Agent 6
- [ ] Fix uses safe patterns (SafeERC20, nonReentrant, etc.)
```

### 6.2 Pattern Check

If a fix addresses a bug in one location, check if the same pattern exists elsewhere:

```bash
# Example: if fix adds nonReentrant to withdraw(), check all functions with external calls
rg "\.safeTransfer\(|\.transfer\(|\.call\{" src/ --glob "*.sol"
```

---

## Phase 7: Report Generation

### Report Structure

```markdown
# Security Audit Report

## Executive Summary

**Protocol:** [name]
**Scope:** [nSLOC] lines across [N] contracts
**Methodology:** Pashov 8-agent parallel audit
**Duration:** [timeframe]
**Commit:** [hash]

### Findings Summary

| Severity | Count |
|----------|-------|
| Critical | X |
| High | Y |
| Medium | Z |
| Low | W |
| Informational | V |

### Key Observations
- [1-3 sentence summary of the most important findings]
- [Overall assessment of code quality and security posture]

---

## Critical Findings

### [C-01] Finding Title
**Severity:** Critical
**Agents:** [N/8]
**Location:** `src/Contract.sol:L42-L58`

**Description:** ...
**Impact:** ...
**Proof of Concept:** ...
**Recommended Fix:** ...

---

## High Findings

### [H-01] Finding Title
...

---

## Medium Findings

### [M-01] Finding Title
...

---

## Low Findings

### [L-01] Finding Title
...

---

## Informational

### [I-01] Finding Title
...

---

## Appendix

### A. Scope Table
| Contract | nSLOC | Complexity |
|----------|-------|------------|
| ... | ... | ... |

### B. Methodology
8-agent parallel audit with deduplication and PoC verification.

### C. Tools
- Foundry (forge build, forge test)
- Slither static analysis
- Aderyn static analysis
- Manual review by 8 specialized agents

### D. Agent Attribution
| Finding | Agents That Flagged |
|---------|-------------------|
| C-01 | Vector Scan, Math, Execution Trace |
| H-01 | Access Control, First Principles |
| ... | ... |
```

---

## Agent Mapping to EVM Cortex

| Pashov Agent | EVM Cortex Agent(s) | Subagent Type |
|--------------|------------------------|---------------|
| Vector Scan | `audit-orchestrator` + `depth-edge-case` | audit-orchestrator, depth-edge-case |
| Math & Precision | `depth-token-flow` | depth-token-flow |
| Access Control | `access-control-reviewer` | code-reviewer |
| Economic Security | `mev-analyst` + `oracle-analyst` | code-reviewer |
| Execution Trace | `depth-state-trace` | depth-state-trace |
| Invariant | `invariant-analyst` | invariant-tester |
| Periphery | `depth-external` | code-reviewer |
| First Principles | `sleuth` | sleuth |

### Launching Agents in Parallel

Use the `Task` tool to launch all 8 agents simultaneously. Each agent receives:
1. The source bundle (identical for all)
2. The context package (identical for all)
3. Agent-specific instructions (from the sections above)
4. The finding format template

```
Launch 8 Task agents in parallel:
  - Agent 1: subagent_type="audit-orchestrator", prompt="[Vector Scan instructions + source bundle]"
  - Agent 2: subagent_type="depth-token-flow", prompt="[Math instructions + source bundle]"
  - Agent 3: subagent_type="code-reviewer", prompt="[Access Control instructions + source bundle]"
  - Agent 4: subagent_type="code-reviewer", prompt="[Economic Security instructions + source bundle]"
  - Agent 5: subagent_type="depth-state-trace", prompt="[Execution Trace instructions + source bundle]"
  - Agent 6: subagent_type="invariant-tester", prompt="[Invariant instructions + source bundle]"
  - Agent 7: subagent_type="code-reviewer", prompt="[Periphery instructions + source bundle]"
  - Agent 8: subagent_type="sleuth", prompt="[First Principles instructions + source bundle]"
```

After all 8 return, run deduplication and validation as a single sequential step.

---

## Pre-Audit Checklist

- [ ] All in-scope files identified and listed in scope table
- [ ] Source bundle generated with all in-scope files
- [ ] Context package assembled (README, known issues, design docs)
- [ ] `forge build --deny-warnings` passes clean
- [ ] `forge test` passes with no failures
- [ ] Slither baseline report generated
- [ ] Prior audit reports reviewed (if any)
- [ ] Known issues documented to avoid duplicate findings
- [ ] All 8 agent prompts prepared with source bundle and instructions

## Post-Audit Checklist

- [ ] All 8 agents returned findings
- [ ] Findings grouped by `group_key`
- [ ] Duplicates merged with best PoC retained
- [ ] Chain findings identified and composed
- [ ] All FINDINGs passed gate evaluation
- [ ] LEADs promoted or demoted with justification
- [ ] Severity classification verified against matrix
- [ ] Fix verification completed for confidence ≥ 80 findings
- [ ] Report structured with executive summary
- [ ] Findings numbered by severity (C-01, H-01, M-01, L-01, I-01)
- [ ] Agent attribution table completed
- [ ] Scope table and methodology documented in appendix
- [ ] No deployer-intent reasoning used in severity classification
- [ ] Report reviewed for internal consistency and completeness
