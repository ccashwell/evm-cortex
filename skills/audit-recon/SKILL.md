---
name: audit-recon
description: Use when performing initial audit reconnaissance. Covers automated tooling, dependency review, architecture mapping, entry point identification, trust boundary mapping, external call enumeration, and access control analysis.
---

# Audit Reconnaissance

## Phase Overview

Recon is the first phase of a security audit. The goal is to build a mental model of the system before diving into code. Spend 10-20% of total audit time here.

## Step 1: Automated Tools First

Run automated scanners to identify low-hanging fruit and build familiarity:

```bash
# Slither — static analysis
slither . --filter-paths "test|script|node_modules" \
    --print human-summary \
    --print contract-summary

# Aderyn — Solidity-specific linter
aderyn . --exclude test/ --output aderyn-report.md

# Solidity Metrics — complexity and SLOC
solidity-metrics src/

# Dependency tree
forge tree
```

### Slither Detectors to Focus On

| Detector | Severity | What It Finds |
|----------|----------|---------------|
| `reentrancy-eth` | High | ETH reentrancy |
| `reentrancy-no-eth` | Medium | State reentrancy |
| `unchecked-transfer` | High | Unchecked ERC20 returns |
| `arbitrary-send-eth` | High | Uncontrolled ETH transfer |
| `suicidal` | High | Unprotected selfdestruct |
| `uninitialized-state` | High | Uninitialized variables |
| `controlled-delegatecall` | High | User-controlled delegatecall |

### Slither Printers for Recon

```bash
# Call graph
slither . --print call-graph

# Function summary (visibility, modifiers, state changes)
slither . --print function-summary

# Inheritance graph
slither . --print inheritance-graph

# Variables read/written per function
slither . --print vars-and-auth
```

## Step 2: Dependency Review

```bash
# List all dependencies and versions
forge tree

# Check for known vulnerabilities
# Cross-reference OpenZeppelin version against security advisories
# https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories
```

Key questions:
- Are dependencies pinned to specific commits/versions?
- Any modified/forked dependencies?
- Solidity compiler version — known compiler bugs?

## Step 3: Architecture Mapping

Build this map by reading code, starting from entry points:

```markdown
## Contract Map

### Core
- Vault.sol (512 SLOC) — main entry point
  - Inherits: ERC4626, Ownable, ReentrancyGuard, Pausable
  - External calls: Strategy, Oracle, USDC
  - State: deposits, withdrawals, share pricing

### Periphery
- Strategy.sol (189 SLOC) — yield deployment
  - External calls: Aave Pool, USDC
  - Called by: Vault (only)

### Libraries
- MathLib.sol (45 SLOC) — fixed-point math
  - Pure functions, no state
```

## Step 4: Entry Point Identification

Map every `external` and `public` function with their access control:

```markdown
## Entry Points

| Contract | Function | Access | State Changes | Risk |
|----------|----------|--------|---------------|------|
| Vault | deposit(uint256,address) | Anyone | balances, totalSupply | Medium |
| Vault | withdraw(uint256,address,address) | Owner/approved | balances, totalSupply | High |
| Vault | setStrategy(address) | Owner only | strategy | Critical |
| Vault | pause() | Owner only | paused flag | Low |
| Strategy | harvest() | Keeper only | deployed amount | Medium |
| Strategy | emergencyWithdraw() | Owner only | all state | Critical |
```

## Step 5: Trust Boundary Mapping

```markdown
## Trust Boundaries

### Fully Trusted
- Owner multisig (can change parameters, pause, upgrade strategy)
- Timelock controller (executes governance decisions)

### Semi-Trusted
- Keeper bot (can trigger harvest, but cannot steal funds)
- Oracle feeds (Chainlink — trusted but can go stale)

### Untrusted
- End users (deposit/withdraw — fully adversarial)
- External protocols (Aave — could be exploited)
- Token contracts (USDC — could blacklist)

### Attack Surfaces by Trust Level
1. Untrusted user -> Vault: reentrancy, share manipulation, front-running
2. Stale oracle -> Vault: incorrect valuations, over-borrowing
3. Compromised keeper -> Strategy: timing attacks on harvest
4. External protocol exploit -> Strategy: loss of deployed funds
```

## Step 6: External Call Mapping

Every external call is a potential vulnerability vector:

```markdown
## External Calls

| Source | Target | Function | Untrusted? | Risk |
|--------|--------|----------|------------|------|
| Vault | USDC | transferFrom | No (known) | Low |
| Vault | Strategy | deploy | No (owned) | Low |
| Strategy | Aave Pool | supply | Semi | Medium |
| Strategy | Aave Pool | withdraw | Semi | Medium |
| Oracle | Chainlink | latestRoundData | Semi | Medium |
```

## Step 7: Access Control Enumeration

```bash
# Use Slither to enumerate access controls
slither . --print vars-and-auth

# Manually verify:
# 1. Every onlyOwner function is truly admin-only
# 2. No function missing access control that modifies state
# 3. Initializer functions protected against re-initialization
# 4. Constructor sets correct initial values
```

## Recon Report Template

```markdown
# Audit Recon Report — [Protocol Name]

## Summary
- **Total SLOC**: X
- **Contracts in scope**: Y
- **External dependencies**: Z
- **Compiler**: solc X.Y.Z

## Architecture Diagram
[Mermaid or text diagram]

## Entry Points (sorted by risk)
[Table from Step 4]

## External Calls
[Table from Step 6]

## Trust Boundaries
[From Step 5]

## Automated Tool Findings
- Slither: X high, Y medium, Z low (after triage)
- Aderyn: X findings

## Initial Leads for Depth Analysis
1. [Finding/area that needs deeper review]
2. [Suspicious pattern identified]
3. [Complex logic requiring manual review]
```

## Checklist

- [ ] Slither run with findings triaged (true/false positive)
- [ ] Aderyn run reviewed
- [ ] Dependency versions checked against known vulnerabilities
- [ ] All entry points mapped with access controls
- [ ] External calls enumerated and risk-assessed
- [ ] Trust boundaries documented
- [ ] Architecture diagram created
- [ ] Initial depth-analysis leads identified
- [ ] Recon report completed before moving to breadth scan
