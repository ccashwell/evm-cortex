---
name: slither-analysis
description: Use when running Slither static analysis on Solidity contracts. Covers running slither, key detectors, false positive filtering, severity levels, upgradeability checks, CI integration, and triage methodology.
---

# Slither Static Analysis

## Installation

```bash
pip3 install slither-analyzer
# or
pipx install slither-analyzer

# Verify
slither --version
```

## Running Slither

```bash
# Basic analysis
slither .

# Target specific contract
slither src/MyContract.sol

# JSON output for CI
slither . --json slither-report.json

# Specific detectors only
slither . --detect reentrancy-eth,reentrancy-no-eth,uninitialized-state

# Exclude detectors
slither . --exclude naming-convention,pragma

# With Foundry remappings
slither . --foundry-out-directory out
```

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| High | Likely exploitable vulnerability | Fix immediately |
| Medium | Potential vulnerability or bad practice | Fix before deploy |
| Low | Minor issue or informational | Review and decide |
| Informational | Style or optimization suggestion | Nice to fix |
| Optimization | Gas optimization opportunity | Fix if meaningful |

## Key Detectors

### Critical / High

| Detector | Description |
|----------|-------------|
| `reentrancy-eth` | Reentrancy with ETH transfer |
| `reentrancy-no-eth` | Reentrancy without ETH |
| `arbitrary-send-eth` | Unprotected ETH send |
| `arbitrary-send-erc20` | Unprotected token transfer |
| `suicidal` | Unprotected selfdestruct |
| `uninitialized-state` | State variable not initialized |
| `unprotected-upgrade` | Missing upgrade auth check |
| `delegatecall-loop` | Delegatecall in loop |

### Medium

| Detector | Description |
|----------|-------------|
| `divide-before-multiply` | Precision loss from order of operations |
| `reentrancy-benign` | Reentrancy without direct exploit |
| `tx-origin` | Using tx.origin for auth |
| `unchecked-transfer` | Return value not checked |
| `locked-ether` | Contract can receive but not send ETH |
| `controlled-delegatecall` | User-controlled delegatecall target |

### Low / Informational

| Detector | Description |
|----------|-------------|
| `missing-zero-check` | No zero address validation |
| `calls-loop` | External calls in loop |
| `timestamp` | Block.timestamp usage |
| `assembly` | Inline assembly usage |

## Triage Methodology

1. **Run full analysis**: `slither . --json report.json`
2. **Sort by severity**: address High → Medium → Low
3. **Filter false positives**: mark known-safe patterns
4. **Document findings**: for each real finding, note impact + fix
5. **Fix and re-run**: verify findings are resolved

## Filtering False Positives

Create `slither.config.json`:

```json
{
  "filter_paths": [
    "lib/",
    "test/",
    "script/",
    "node_modules/"
  ],
  "exclude_informational": true,
  "exclude_low": false,
  "exclude_optimization": true,
  "detectors_to_exclude": [
    "naming-convention",
    "pragma",
    "solc-version"
  ]
}
```

Or use inline annotations in Solidity:

```solidity
// slither-disable-next-line reentrancy-benign
token.transfer(to, amount);
```

## Upgradeability Checks

```bash
# Check proxy/implementation compatibility
slither-check-upgradeability . MyContractV1 --proxy-name ERC1967Proxy

# Compare storage layouts between versions
slither-check-upgradeability . MyContractV2 \
  --proxy-name ERC1967Proxy \
  --new-contract-name MyContractV2

# Check for storage collisions
slither . --detect storage-collision
```

## Printers (Code Analysis Tools)

```bash
# Function summary (visibility, modifiers, state changes)
slither . --print function-summary

# Contract inheritance graph
slither . --print inheritance-graph

# Call graph
slither . --print call-graph

# Storage layout
slither . --print variable-order

# Data dependency
slither . --print data-dependency

# Human-readable summary
slither . --print human-summary
```

## CI Integration

### GitHub Actions

```yaml
name: Slither Analysis
on: [push, pull_request]

jobs:
  slither:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1

      - name: Build
        run: forge build

      - name: Run Slither
        uses: crytic/slither-action@v0.4.0
        with:
          sarif: results.sarif
          fail-on: high
          slither-args: --filter-paths "lib/|test/|script/"

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: results.sarif
```

## Common Findings and Fixes

### Reentrancy

```solidity
// FINDING: reentrancy-eth
// FIX: checks-effects-interactions pattern
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount); // CHECK
    balances[msg.sender] -= amount;           // EFFECT
    (bool ok,) = msg.sender.call{value: amount}(""); // INTERACTION
    require(ok);
}
```

### Divide Before Multiply

```solidity
// FINDING: divide-before-multiply
// BAD: precision loss
uint256 result = a / b * c;

// FIX: multiply first
uint256 result = a * c / b;
// Or use FullMath / mulDiv for overflow safety
```

### Unchecked Transfer

```solidity
// FINDING: unchecked-transfer
// FIX: use SafeERC20
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
using SafeERC20 for IERC20;
token.safeTransfer(to, amount);
```

## Workflow Summary

```bash
# 1. Build first
forge build

# 2. Run slither with config
slither . --config slither.config.json

# 3. Generate report
slither . --json report.json --config slither.config.json

# 4. Check upgradeability (if using proxies)
slither-check-upgradeability . MyContract

# 5. Print function summary for review
slither . --print function-summary --filter-paths "lib/|test/"
```
