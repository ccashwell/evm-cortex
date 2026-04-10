---
name: xray-pre-audit
description: Use when preparing for a security audit, performing reconnaissance on a new codebase, or creating a protocol overview. Generates a structured pre-audit report covering architecture overview, threat model, protocol invariants, entry point classification, integration analysis, test coverage gaps, and git history signals.
---

# X-Ray Pre-Audit Reconnaissance

## Overview

X-Ray generates a structured pre-audit report that gives auditors (human or AI) a fast, accurate understanding of a protocol before diving into line-by-line review. The output is an `x-ray/` folder at the project root containing:

- `x-ray.md` — Main report (threat model, invariants, scope, risks, verdict)
- `entry-points.md` — Classified entry point map with call chains and access levels
- `architecture.json` — Machine-readable architecture graph for downstream tooling

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

---

## Step 1: Enumerate & Measure

Before reading any code, quantify the target. Numbers ground the analysis and calibrate effort.

### Source Directory Detection

```bash
# Auto-detect source directory from Foundry config
SRC_DIR=$(grep -oP 'src\s*=\s*"\K[^"]+' foundry.toml 2>/dev/null || echo "src")

# Verify the directory exists
if [ ! -d "$SRC_DIR" ]; then
  echo "ERROR: Source directory '$SRC_DIR' not found"
  exit 1
fi

# Count in-scope Solidity files (exclude interfaces and libraries from third parties)
find "$SRC_DIR" -name "*.sol" \
  -not -path "*/interfaces/*" \
  -not -path "*/lib/*" \
  -not -path "*/test/*" \
  -not -path "*/script/*" \
  -not -path "*/mock/*" | sort
```

### nSLOC Measurement

```bash
# Count non-comment, non-blank source lines of code
find "$SRC_DIR" -name "*.sol" \
  -not -path "*/interfaces/*" \
  -not -path "*/lib/*" \
  -not -path "*/test/*" \
  -not -path "*/script/*" \
  -exec grep -cPv '^\s*(//|/\*|\*|\*/|$)' {} + \
  | awk -F: '{files++; sum+=$NF} END {printf "Files: %d\nnSLOC: %d\n", files, sum}'
```

### Per-File Breakdown

```bash
# nSLOC per file, sorted largest-first (identifies complexity hotspots)
find "$SRC_DIR" -name "*.sol" \
  -not -path "*/interfaces/*" \
  -not -path "*/lib/*" \
  -exec sh -c '
    for f; do
      count=$(grep -cPv "^\s*(//|/\*|\*|\*/|$)" "$f")
      printf "%6d  %s\n" "$count" "$f"
    done
  ' _ {} + | sort -rn
```

### Test Enumeration

```bash
# Test file count
find test/ -name "*.t.sol" 2>/dev/null | wc -l

# Test function count
grep -r "function test" test/ --include="*.t.sol" 2>/dev/null | wc -l

# Detect test types present
echo "--- Test Type Distribution ---"
echo "Unit tests:       $(grep -r 'function test[A-Z]' test/ --include='*.t.sol' 2>/dev/null | grep -v 'Fuzz\|Fork' | wc -l)"
echo "Fuzz tests:       $(grep -r 'function testFuzz' test/ --include='*.t.sol' 2>/dev/null | wc -l)"
echo "Invariant tests:  $(grep -r 'function invariant_' test/ --include='*.t.sol' 2>/dev/null | wc -l)"
echo "Fork tests:       $(grep -r 'vm\.createFork\|vm\.createSelectFork' test/ --include='*.t.sol' 2>/dev/null | wc -l)"
```

### Coverage (Background)

Run coverage in the background — it can be slow on large codebases:

```bash
# Try standard coverage first, fall back to IR pipeline
forge coverage 2>&1 || forge coverage --ir-minimum 2>&1
```

Parse the coverage summary table when complete. Flag any contract with < 80% branch coverage.

### Compiler & Dependency Snapshot

```bash
# Solidity compiler version
grep -r 'pragma solidity' "$SRC_DIR" --include='*.sol' | sort -u

# Foundry dependency tree
forge tree 2>/dev/null

# OpenZeppelin version (if used)
grep -r 'openzeppelin' foundry.toml remappings.txt lib/ 2>/dev/null | head -5
```

---

## Step 2: Source Analysis

### Per-File Extraction

For each in-scope `.sol` file, extract the following into structured notes:

#### Contract Identity
- **Type**: `contract`, `abstract contract`, `library`, or `interface`
- **Inheritance chain**: full linearization (affects function resolution order)
- **Pragma**: exact Solidity version
- **License**: SPDX identifier

#### Access Control Inventory
```bash
# Roles and modifiers used across the codebase
grep -rnP '(onlyOwner|onlyRole|onlyAdmin|require\s*\(\s*msg\.sender|_checkRole|hasRole|modifier\s+only)' \
  "$SRC_DIR" --include='*.sol'

# Role constants
grep -rnP '(bytes32\s+(public\s+)?constant\s+\w*ROLE|DEFAULT_ADMIN_ROLE|keccak256)' \
  "$SRC_DIR" --include='*.sol'
```

#### Value-Holding State
```bash
# State variables likely holding value
grep -rnP '(mapping.*balance|mapping.*deposit|mapping.*collateral|mapping.*stake|mapping.*reserve|totalSupply|totalAssets|totalDebt)' \
  "$SRC_DIR" --include='*.sol'
```

#### External Calls
```bash
# All external calls (potential reentrancy vectors)
grep -rnP '\.(call|delegatecall|staticcall|transfer|send|safeTransfer|safeTransferFrom|approve|safeApprove)\s*[\({]' \
  "$SRC_DIR" --include='*.sol'
```

#### Fund Flow Functions
```bash
# Deposit / withdraw / mint / burn / transfer patterns
grep -rnP 'function\s+(deposit|withdraw|mint|burn|transfer|borrow|repay|liquidate|stake|unstake|claim|harvest|swap|addLiquidity|removeLiquidity)\s*\(' \
  "$SRC_DIR" --include='*.sol'
```

#### Invariant Markers
```bash
# Explicit invariant assertions
grep -rnP '(require|assert|revert|@invariant|INVARIANT|invariant:)' \
  "$SRC_DIR" --include='*.sol'
```

### Entry Point Classification

This is the single most important deliverable. Every external state-changing function is an attack surface.

#### Extraction

```bash
# Single-line signatures — external/public non-view functions
grep -rnP 'function\s+\w+\s*\([^)]*\)\s+(external|public)(?!.*\b(view|pure)\b)' \
  "$SRC_DIR" --include='*.sol'

# Multi-line signatures (visibility on a subsequent line)
grep -rnP '^\s*\)\s+(external|public)(?!.*\b(view|pure)\b)' \
  "$SRC_DIR" --include='*.sol' -B5
```

#### Classification Rules

For each entry point, classify access level by examining both modifiers and function body:

| Access Level | Criteria | Risk |
|-------------|----------|------|
| **Permissionless** | No access modifier AND no internal `msg.sender` / `tx.origin` check. Verify the full function body. | HIGHEST |
| **Role-gated** | Has a role-based modifier (`onlyRole`, `hasRole`) OR checks `msg.sender` against a stored address | MEDIUM |
| **Admin-only** | `onlyOwner`, `DEFAULT_ADMIN_ROLE`, or equivalent top-level authority | LOWER (but centralization risk) |
| **Internal-only** | Called exclusively by other contract functions, never directly | CONTEXT-DEPENDENT |

**Critical**: A function without a modifier is NOT automatically permissionless. Check the function body for:
```solidity
if (msg.sender != expectedAddress) revert Unauthorized();
```

#### Entry Point Record Schema

For each entry point, record:

```markdown
| Field | Value |
|-------|-------|
| Contract | Pool.sol |
| Function | `deposit(uint256 assets, address receiver)` |
| Visibility | external |
| Access Level | Permissionless |
| Required Role | — |
| User-Controlled Params | `assets` (amount), `receiver` (address) |
| Call Chain | deposit → _deposit → _mint → _afterDeposit → strategy.deploy |
| State Modified | balances[receiver], totalSupply, totalAssets |
| Value Flow | IN (tokens transferred from caller) |
| Reentrancy Guard | Yes (nonReentrant) |
| ETH Handling | No |
```

#### Output: entry-points.md

Write all classified entry points to `x-ray/entry-points.md`, organized by contract and sorted by risk (permissionless first):

```markdown
# Entry Points

## Risk Summary
- Permissionless: X functions (HIGHEST PRIORITY)
- Role-gated: Y functions
- Admin-only: Z functions

## [Contract: Pool.sol]

### Permissionless
| Function | Params | Call Chain | State Modified | Value Flow | Reentrancy Guard |
|----------|--------|------------|----------------|------------|-----------------|
| deposit(uint256,address) | assets, receiver | → _deposit → _mint | balances, totalSupply | IN | Yes |

### Role-Gated
...

### Admin-Only
...
```

---

## Step 3: Protocol Classification

### Protocol Type Detection

Scan function names, NatSpec, and state variables to classify the protocol:

| Type | Signal Functions / Variables | Secondary Signals |
|------|---------------------------|-------------------|
| **Lending** | borrow, repay, liquidate, collateral, healthFactor, interestRate | LTV, utilization, reserves |
| **AMM/DEX** | swap, addLiquidity, removeLiquidity, sqrtPrice, tick | fee tier, pool, factory |
| **Vault/Yield** | deposit, withdraw, totalAssets, convertToShares | ERC-4626 interface, strategy, harvest |
| **Staking** | stake, unstake, getReward, rewardPerToken, epoch | delegation, slashing, unbonding |
| **Governance** | propose, vote, execute, queue, timelock | quorum, votingPeriod, proposalThreshold |
| **Bridge** | send, receive, attestation, messageTransmitter | domain, nonce, relayer |
| **NFT/Marketplace** | mint, list, buy, offer, royalty | tokenURI, ownerOf, setApprovalForAll |
| **Stablecoin** | mint, burn, peg, collateralizationRatio | price stability, PSM, debt ceiling |
| **Options/Perps** | openPosition, closePosition, settle, margin | strike, expiry, funding rate |

Protocols are often hybrids. Classify primary and secondary types:

```markdown
Primary: Vault/Yield (ERC-4626 vault with strategy pattern)
Secondary: Lending integration (deploys to Aave), DEX integration (harvests via Uniswap)
```

### Temporal Risk Phase Assessment

| Phase | Signals | Risk Profile |
|-------|---------|-------------|
| **Pre-launch** | No TVL, initializers present, test deployments only | Lower (no funds at risk yet), but code bugs compound later |
| **Launch** | Low TVL, bootstrap/migration parameters, initial liquidity | HIGH (first-mover attacks, parameter misconfiguration) |
| **Growth** | Increasing TVL, governance becoming active, integrations added | MEDIUM (parameters stabilizing, new attack surface from integrations) |
| **Mature** | High TVL, timelocked governance, battle-tested | MEDIUM-HIGH (high-value target, complex state, upgrade risk) |

Determine phase from:
- Deployment scripts present but no mainnet addresses → Pre-launch
- Recent mainnet deployment in git history → Launch
- Governance proposals in history → Growth/Mature
- TVL data from onchain queries if available

---

## Step 4: Threat Model Construction

The threat model is the analytical core of X-Ray. It maps actors, trust boundaries, and attack surfaces.

### Actor Enumeration

Identify every actor that can interact with the protocol:

```markdown
| Actor | Entry Points | Trust Level | Capabilities |
|-------|-------------|-------------|-------------|
| EOA User | deposit, withdraw, claim | Untrusted | Can call all permissionless functions |
| Contract User | deposit, withdraw, claim | Untrusted + Reentrancy risk | Same as EOA, but can execute code on callbacks |
| Keeper | harvest, rebalance, liquidate | Semi-trusted | Limited to specific operations, cannot extract funds directly |
| Admin (multisig) | setFee, pause, setStrategy | Trusted | Can change protocol parameters, pause operations |
| Timelock | upgradeProxy, setOracle | Trusted (delayed) | Delayed execution provides exit window |
| Oracle | price feeds | External trust | Price data consumed by protocol; manipulation = critical |
| Integrated Protocol | Aave, Uniswap | External trust | Protocol depends on their correct operation |
| Flashloan Attacker | Any permissionless function | Adversarial | Unlimited capital within a single transaction |
```

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

### Protocol-Type Threat Profiles

Select the relevant profile based on Step 3 classification and enumerate primary threats:

#### Lending Threats
| Threat | Vector | Impact |
|--------|--------|--------|
| Oracle manipulation | Flash loan → manipulate price feed → borrow at inflated collateral value | Bad debt, protocol insolvency |
| Liquidation cascade | Sharp price move → mass liquidations → liquidator profit extraction | Bank run, insufficient liquidity |
| Interest rate gaming | Manipulate utilization rate → force high/low interest on others | Economic loss for depositors |
| Collateral factor exploit | Governance sets unsafe CF → under-collateralized borrowing | Bad debt |

#### AMM/DEX Threats
| Threat | Vector | Impact |
|--------|--------|--------|
| Price manipulation | Flash loan → large swap → exploit dependent protocol → swap back | Value extraction from integrated protocols |
| Sandwich attacks | Front-run user swap → inflate price → back-run | User gets worse execution |
| JIT liquidity | Add liquidity before large swap → collect fees → remove | Fee extraction from passive LPs |
| Fee redirection | Admin changes fee recipient or adds hidden fee | Rug pull / value extraction |

#### Vault/Yield Threats
| Threat | Vector | Impact |
|--------|--------|--------|
| ERC-4626 inflation attack | First depositor mints 1 share → donates large amount → subsequent depositors get 0 shares | Theft of deposits |
| Strategy loss socialization | Strategy loses funds → loss spread across all depositors unfairly | Unfair loss distribution |
| Withdrawal queue manipulation | Block withdrawals → exploit trapped liquidity | Denial of service, forced holding |
| Harvest sandwich | Front-run harvest → deposit before yield → withdraw after | Yield extraction without time commitment |

#### Cross-Cutting Threats (Apply to ALL Protocols)
| Threat | Vector | Impact |
|--------|--------|--------|
| Reentrancy | External call → callback → re-enter state-changing function | Double-spend, state corruption |
| Access control bypass | Missing modifier, incorrect role check, initializer re-call | Unauthorized privileged operations |
| Rounding exploitation | Systematic rounding in attacker's favor across many small operations | Slow value drain |
| Griefing / DoS | Revert on transfer, gas griefing, storage bloat | Protocol unusable |
| Upgrade hijack | Unprotected initializer, storage collision, proxy admin takeover | Complete protocol compromise |
| Centralization rug | Admin key compromise or malicious admin action | Total loss of funds |

### Composability Dependency Map

For each external dependency, assess:

```markdown
| Dependency | Type | Address | Failure Mode | Impact on Protocol |
|-----------|------|---------|-------------|-------------------|
| Chainlink ETH/USD | Oracle | 0x5f4e... | Stale price, zero price, negative price | Incorrect valuations → bad debt or unfair liquidations |
| Aave V3 Pool | Lending | 0x8787... | Paused, insolvent, governance attack | Strategy funds locked or lost |
| USDC | Token | 0xA0b8... | Blacklist vault address, pause transfers | All operations halt |
| Uniswap V3 Router | DEX | 0xE592... | Manipulated pool, zero liquidity | Swap reverts or bad execution |
```

---

## Step 5: Invariant Identification

Invariants are properties that must hold true across ALL state transitions. They are the backbone of protocol correctness.

### Extraction Sources

1. **Explicit assertions**: `require`, `assert`, custom error checks
2. **NatSpec annotations**: `@invariant` tags, "must never" / "always" language in `@dev` comments
3. **Documentation**: Whitepaper, README, spec documents
4. **Design patterns**: ERC standards imply invariants (e.g., ERC-4626 share accounting)
5. **Inferred from mechanics**: What MUST be true for the protocol to not lose money?

### Invariant Categories

#### Accounting Invariants
```
INVARIANT-ACC-1: sum(balances[user] for all users) == totalSupply
INVARIANT-ACC-2: totalAssets >= totalSupply * minSharePrice (no value extraction)
INVARIANT-ACC-3: strategy.deployed + vault.idle == vault.totalAssets (all funds accounted)
INVARIANT-ACC-4: sum(debt[user]) == totalDebt (lending protocols)
INVARIANT-ACC-5: reserveBalance >= sum(pendingWithdrawals)
```

#### Access Control Invariants
```
INVARIANT-ACL-1: Only authorized roles can modify protocol parameters
INVARIANT-ACL-2: Only authorized roles can pause/unpause
INVARIANT-ACL-3: Initializers can only be called once
INVARIANT-ACL-4: Proxy admin cannot be zero address
INVARIANT-ACL-5: Role admin hierarchy is acyclic
```

#### Economic Invariants
```
INVARIANT-ECON-1: Share price monotonically non-decreasing (absent explicit loss event)
INVARIANT-ECON-2: Fees never exceed configured maximum
INVARIANT-ECON-3: Collateral ratio always above minimum threshold after user action
INVARIANT-ECON-4: No single transaction can extract more value than it provides
INVARIANT-ECON-5: Liquidation always improves protocol health factor
```

#### Liveness Invariants
```
INVARIANT-LIVE-1: Users can always withdraw their funds (no permanent lock)
INVARIANT-LIVE-2: Governance proposals can always be executed after timelock
INVARIANT-LIVE-3: Emergency functions remain callable even when paused
INVARIANT-LIVE-4: No function can permanently brick the contract
```

### Invariant Confidence Levels

| Level | Source | Reliability |
|-------|--------|------------|
| **Verified** | Tested by invariant test or formal property | Highest |
| **Explicit** | Written in code as require/assert | High |
| **Documented** | Stated in NatSpec or documentation | Medium |
| **Inferred** | Derived from protocol mechanics by analysis | Lower — MUST verify |
| **Assumed** | Common in protocol type but not explicitly stated | Lowest — flag for review |

---

## Step 6: Git History Analysis

Git history reveals what the team worries about, where complexity lives, and what has been fixed.

### Security-Relevant Signals

```bash
# Recent commits touching in-scope files (activity level)
git log --oneline --since="3 months ago" -- "$SRC_DIR" | head -20

# Files changed most frequently — complexity and instability hotspots
git log --pretty=format: --name-only --since="6 months ago" -- "$SRC_DIR" \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -10

# Fix / security / vulnerability related commits
git log --oneline --all --grep="fix\|bug\|vuln\|security\|patch\|revert\|hotfix\|exploit" -- "$SRC_DIR"

# Large commits (potential rushed changes)
git log --oneline --shortstat --since="3 months ago" -- "$SRC_DIR" \
  | grep -P '\d{2,} files changed|\d{3,} insertions'

# Authors — bus factor and review patterns
git shortlog -sn --since="6 months ago" -- "$SRC_DIR"
```

### Test Co-Change Rate

Do source changes come with test changes? A low co-change rate signals undertesting:

```bash
# Count commits that touch both src/ and test/
TOTAL=$(git log --oneline --since="3 months ago" -- "$SRC_DIR" | wc -l)
WITH_TESTS=$(git log --oneline --since="3 months ago" -- "$SRC_DIR" test/ \
  | sort -u | comm -12 \
  <(git log --oneline --since="3 months ago" -- "$SRC_DIR" | sort) \
  <(git log --oneline --since="3 months ago" -- test/ | sort) | wc -l)
echo "Test co-change rate: $WITH_TESTS / $TOTAL"
```

### Interpreting Signals

| Signal | What It Means | Action |
|--------|-------------|--------|
| File changed 20+ times in 3 months | Unstable / complex — high bug density | Prioritize for depth analysis |
| Fix commits on specific file | Known bug area | Check if fixes are complete |
| Single author on critical contract | Bus factor = 1, less review | Extra scrutiny |
| No test co-changes | Changes deployed without test coverage | Flag coverage gaps |
| Reverted commits | Something went wrong | Investigate what and why |
| Large commit touching many files | Refactor or rushed feature | Check for regressions |

---

## Step 7: Architecture Graph

Generate a machine-readable architecture graph for downstream tools and agents.

### architecture.json Schema

```json
{
  "protocol": "ProtocolName",
  "commit": "abc1234def5678",
  "generated": "2026-04-10T00:00:00Z",
  "classification": {
    "primary": "Vault/Yield",
    "secondary": ["Lending integration"],
    "phase": "Pre-launch"
  },
  "contracts": [
    {
      "name": "Vault",
      "file": "src/Vault.sol",
      "type": "contract",
      "nsloc": 450,
      "inherits": ["ERC4626", "Ownable", "ReentrancyGuard", "Pausable"],
      "roles": ["owner", "keeper"],
      "externalCalls": ["Strategy", "IERC20", "IOracle"],
      "entryPoints": {
        "permissionless": ["deposit", "withdraw", "redeem"],
        "roleGated": ["harvest", "rebalance"],
        "adminOnly": ["setStrategy", "setFee", "pause"]
      }
    }
  ],
  "dependencies": [
    {
      "name": "OpenZeppelin",
      "version": "5.0.1",
      "type": "library"
    }
  ],
  "externalIntegrations": [
    {
      "name": "Chainlink ETH/USD",
      "type": "oracle",
      "address": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      "trust": "semi-trusted"
    }
  ],
  "edges": [
    { "from": "Vault", "to": "Strategy", "type": "internal-call" },
    { "from": "Strategy", "to": "Aave V3", "type": "external-call" },
    { "from": "Vault", "to": "Chainlink", "type": "oracle-read" }
  ]
}
```

---

## Step 8: Report Generation

### Main Report Template — x-ray.md

```markdown
# X-Ray Pre-Audit Report

## Protocol: [Name]
- **Repository**: [URL]
- **Branch**: `main` at `[commit hash]`
- **Generated**: [ISO 8601 timestamp]
- **nSLOC**: [total]
- **Contracts in scope**: [count]
- **Solidity version**: [version]

---

## 1. Architecture Overview

[2-3 paragraph description of what the protocol does, the key contracts, and how they interact. Mention the deployment target chain(s).]

### Scope Table

| Contract | File | nSLOC | Type | Key Functions |
|----------|------|-------|------|---------------|
| Vault | src/Vault.sol | 450 | Core | deposit, withdraw, harvest |
| Strategy | src/Strategy.sol | 189 | Core | deploy, withdraw, reportLoss |
| Oracle | src/Oracle.sol | 78 | Periphery | getPrice, setFeed |

### Contract Interaction Diagram

[Mermaid diagram or ASCII art showing call relationships]

### Backwards-Compatibility / Legacy Code

[Any deprecated code retained for storage layout compatibility, migration paths, or interface stability. If none, state "None identified."]

---

## 2. Threat & Trust Model

### Protocol Classification
- **Primary**: [Lending / AMM / Vault / Staking / Governance / Bridge / ...]
- **Secondary**: [Integration types]
- **Phase**: [Pre-launch / Launch / Growth / Mature]

### Actors

| Actor | Entry Points | Trust Level | Capabilities |
|-------|-------------|-------------|-------------|
| ... | ... | ... | ... |

### Trust Boundaries

[Describe where trust assumptions change — which contracts trust each other, which external calls cross trust boundaries]

### Key Attack Surfaces (Top 5)

| # | Surface | Severity | Rationale |
|---|---------|----------|-----------|
| 1 | [Most critical attack surface] | Critical/High | [Why] |
| 2 | ... | ... | ... |

### Permissionless Entry Points

[Functions callable by anyone — these receive the most scrutiny]

| Function | Contract | Params | Value Flow | Guard |
|----------|----------|--------|------------|-------|
| ... | ... | ... | ... | ... |

---

## 3. Invariants

### Accounting
[List all accounting invariants with confidence level]

### Access Control
[List all access control invariants]

### Economic
[List all economic invariants]

### Liveness
[List all liveness invariants]

---

## 4. External Integrations

| Dependency | Type | Trust | Failure Mode | Mitigation |
|-----------|------|-------|-------------|-----------|
| ... | ... | ... | ... | ... |

---

## 5. Centralization Risks

| Risk | Mechanism | Mitigation |
|------|----------|-----------|
| Admin can change strategy | setStrategy(address) | Timelock (if present) |
| Admin can pause all operations | pause() | Emergency function bypasses pause |
| ... | ... | ... |

---

## 6. Test Analysis

### Coverage Summary

| Contract | Line % | Branch % | Function % | Verdict |
|----------|--------|----------|-----------|---------|
| ... | ... | ... | ... | OK / GAP |

### Test Type Distribution
- Unit tests: X
- Fuzz tests: X
- Invariant tests: X
- Fork tests: X

### Coverage Gaps

[Specific functions or branches with insufficient coverage]

---

## 7. Git History Signals

### Hotspot Files
[Files changed most frequently — prioritize for review]

### Recent Fix Commits
[Security-relevant fixes in the last 3 months]

### Test Co-Change Rate
[Percentage of src changes accompanied by test changes]

---

## 8. Static Analysis Summary

### Slither
[High-level summary: X high, Y medium, Z low — after false-positive triage]

### Aderyn
[Summary of findings]

### Key Findings Requiring Manual Review
[Findings that automated tools flagged but need human/agent judgment]

---

## 9. X-Ray Verdict

### Audit Readiness: [READY / NEEDS WORK / NOT READY]

| Criterion | Status | Notes |
|-----------|--------|-------|
| Build succeeds | ✅/❌ | |
| Tests pass | ✅/❌ | |
| Coverage > 80% on core | ✅/❌ | |
| NatSpec on public functions | ✅/❌ | |
| Invariants documented | ✅/❌ | |
| Known issues listed | ✅/❌ | |
| No critical Slither findings | ✅/❌ | |
| Architecture documented | ✅/❌ | |

### Top Concerns for Auditors

1. [Highest priority concern — what to look at first]
2. [Second priority]
3. [Third priority]

### Recommended Audit Mode

[Light / Core / Thorough — based on complexity, TVL risk, and readiness]
```

---

## Step 9: Integration with EVM Cortex Agents

X-Ray is designed to feed directly into the EVM Cortex audit pipeline:

| Agent | Receives from X-Ray | Uses It For |
|-------|---------------------|-------------|
| `scout` | Request to explore codebase | Initial file discovery before X-Ray runs |
| `audit-orchestrator` | Full X-Ray report | Scoping audit mode, routing depth agents |
| `invariant-analyst` | Invariant list (Step 5) | Deepening invariant identification, writing invariant tests |
| `invariant-tester` | Invariants + entry points | Writing Foundry invariant test suites |
| `slither-analyst` | Static analysis output | Triaging Slither findings alongside X-Ray context |
| `depth-state-trace` | Entry points + state variables | Tracing state mutations through high-risk paths |
| `depth-token-flow` | Fund flow functions + token list | Verifying token accounting correctness |
| `depth-edge-case` | Entry points + invariants | Enumerating boundary conditions |
| `depth-external` | External call map | Analyzing reentrancy and callback risks |
| `code-reviewer` | Scope table + architecture | Focused code review with full context |
| `poc-writer` | Threat model findings | Writing exploit PoCs for identified threats |
| `scribe` | Full X-Ray report | Generating the final audit report |

### Orchestration Example

```
1. scout       → explores codebase, identifies src layout
2. xray        → generates x-ray/ folder with full report
3. audit-orchestrator reads x-ray.md
   ├── Routes accounting concerns → depth-token-flow
   ├── Routes state mutation risks → depth-state-trace
   ├── Routes boundary conditions → depth-edge-case
   └── Routes external calls → depth-external
4. invariant-tester → writes tests from x-ray invariant list
5. poc-writer   → PoCs for confirmed findings
6. scribe       → final report incorporating all outputs
```

---

## Step 10: Constraints & Quality Standards

### Hard Constraints
- **Under 500 lines** for the main `x-ray.md` report. Move detailed entry point data to `entry-points.md`.
- **No fabrication**. Never invent contract addresses, function signatures, or findings. If a determination cannot be made from the code, write "Could not determine from available source" with the specific reason.
- **Fully autonomous**. No user interaction required during analysis. All steps run without prompting.
- **Verify before stating**. Every security claim must reference specific code. Never assert "function X is safe" without checking.
- **Commit-pinned**. Record the exact commit hash at the top of every generated file. The report is only valid for that commit.

### Quality Standards
- Entry points must be exhaustive — missing an entry point means missing an attack surface.
- Invariants must distinguish confidence level (verified vs. inferred).
- Threat model must be specific to THIS protocol, not generic boilerplate.
- Architecture graph must be parseable JSON that downstream tools can consume.
- Coverage gaps must reference specific functions, not just percentages.

### What X-Ray Does NOT Do
- **Line-by-line code review** — that is the breadth/depth scan's job
- **PoC construction** — that is `poc-writer`'s job
- **Formal verification** — that is `formal-verifier`'s job
- **Fix recommendations** — X-Ray identifies; other agents remediate
- **Deployment verification** — that is `verifier`'s job

---

## Pre-Audit Readiness Checklist

Run this checklist to determine if a codebase is ready for audit. X-Ray populates the answers.

### Build & Test Infrastructure
- [ ] `forge build` succeeds with zero warnings
- [ ] `forge test` passes — all tests green
- [ ] `forge coverage` runs without error
- [ ] Foundry.toml properly configured (src, test, script paths)
- [ ] Dependencies pinned to specific versions (no floating refs)
- [ ] No modified/forked third-party code without documentation

### Code Quality
- [ ] NatSpec on all external/public functions (`@notice`, `@param`, `@return`)
- [ ] Custom errors used (no `require` strings)
- [ ] Named imports only (no wildcard `import "..."`)
- [ ] Consistent Solidity version across all files
- [ ] `forge fmt` produces no diff
- [ ] No TODO/FIXME/HACK comments in production code

### Security Posture
- [ ] Checks-effects-interactions pattern followed
- [ ] `ReentrancyGuard` on functions with external calls
- [ ] `SafeERC20` used for all token interactions
- [ ] Access control on all state-changing functions
- [ ] Initializers protected against re-initialization
- [ ] No hardcoded addresses in source (use immutables/constructor)
- [ ] Events emitted for all state changes

### Documentation
- [ ] Architecture document exists
- [ ] Protocol invariants documented
- [ ] Known issues / accepted risks listed
- [ ] External dependency trust assumptions stated
- [ ] Deployment plan documented
- [ ] Admin capabilities and powers enumerated

### Static Analysis
- [ ] Slither run with findings triaged
- [ ] All High-severity Slither findings resolved or documented
- [ ] Aderyn run reviewed (if available)

### Test Coverage
- [ ] Core contracts > 90% branch coverage
- [ ] Periphery contracts > 80% branch coverage
- [ ] Edge cases tested: zero amounts, max values, first/last operations
- [ ] Fuzz tests present for math-heavy functions
- [ ] Invariant tests present for core accounting
- [ ] Fork tests present for external integrations

### Git Hygiene
- [ ] Audit scope pinned to specific commit
- [ ] No uncommitted changes in scope
- [ ] Branch is up to date with main
- [ ] CI passes on the audit commit

---

## Output File Structure

After X-Ray completes, the project should contain:

```
project/
├── x-ray/
│   ├── x-ray.md           # Main pre-audit report (< 500 lines)
│   ├── entry-points.md    # Full entry point classification
│   └── architecture.json  # Machine-readable architecture graph
├── src/                   # Source contracts (unchanged)
├── test/                  # Test suite (unchanged)
└── foundry.toml           # Build config (unchanged)
```

All three files are generated fresh on each X-Ray run. They are gitignored by default (add to `.gitignore` if not present). To preserve a snapshot, commit the `x-ray/` folder with the audit commit hash in the commit message.
