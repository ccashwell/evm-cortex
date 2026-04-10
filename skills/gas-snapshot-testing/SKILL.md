---
name: gas-snapshot-testing
description: Use when tracking gas costs, detecting regressions in CI, or optimizing Solidity contracts. Covers forge snapshot, gas reports, CI integration, and optimization techniques.
---

# Gas Snapshot Testing

## Overview

Gas snapshots capture the gas cost of every test function and store them in `.gas-snapshot`. This file is committed to the repo and used in CI to detect gas regressions.

## Creating Snapshots

```bash
# Generate gas snapshot
forge snapshot

# Output stored in .gas-snapshot:
# MyContractTest:test_deposit() (gas: 45231)
# MyContractTest:test_withdraw() (gas: 38912)
# MyContractTest:test_transfer() (gas: 21453)
```

## Checking for Regressions in CI

```bash
# Compare current gas against committed snapshot
# Fails if any test uses more gas than recorded
forge snapshot --check

# Allow up to 5% increase
forge snapshot --tolerance 5
```

## Gas Report

```bash
# Detailed per-function gas breakdown
forge test --gas-report

# Output:
# | src/Vault.sol:Vault |                 |       |        |       |         |
# |---------------------|-----------------|-------|--------|-------|---------|
# | Function Name       | min             | avg   | median | max   | # calls |
# | deposit             | 45231           | 47892 | 45231  | 53214 | 12      |
# | withdraw            | 38912           | 40123 | 38912  | 42345 | 8       |

# Filter to specific contracts
forge test --gas-report --match-contract Vault
```

## CI Integration

### GitHub Actions

```yaml
name: Gas Check
on: [pull_request]

jobs:
  gas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1

      - name: Install dependencies
        run: forge install

      - name: Check gas snapshots
        run: forge snapshot --check --tolerance 3

      - name: Gas report
        run: forge test --gas-report | tee gas-report.txt

      - name: Comment gas report on PR
        uses: actions/github-script@v7
        if: github.event_name == 'pull_request'
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('gas-report.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Gas Report\n\`\`\`\n${report}\n\`\`\``
            });
```

## Snapshot-Driven Development

```bash
# 1. Create baseline snapshot
forge snapshot --snap .gas-snapshot-baseline

# 2. Make optimizations
# ... edit contracts ...

# 3. Compare against baseline
forge snapshot --diff .gas-snapshot-baseline

# Output shows differences:
# test_deposit() (gas: 45231 -> 42100) -3131 (-6.92%)
# test_withdraw() (gas: 38912 -> 38900) -12 (-0.03%)
```

## Gas-Specific Test Patterns

```solidity
contract GasTest is Test {
    MyContract target;

    function setUp() public {
        target = new MyContract();
        // Warm storage slots for realistic measurements
        target.initialize();
    }

    // Naming convention: gas_ prefix for benchmark tests
    function test_gas_deposit_firstTime() public {
        // Cold storage write — most expensive
        target.deposit(1 ether);
    }

    function test_gas_deposit_subsequent() public {
        target.deposit(1 ether); // warm up
        target.deposit(1 ether); // measure this
    }

    function test_gas_batchDeposit_10() public {
        for (uint256 i = 0; i < 10; i++) {
            target.deposit(1 ether);
        }
    }

    // Measure specific operations with gasleft()
    function test_gas_specificOperation() public {
        // Setup (not measured)
        target.deposit(1 ether);

        uint256 gasBefore = gasleft();
        target.withdraw(0.5 ether);
        uint256 gasUsed = gasBefore - gasleft();

        // Log for manual review
        emit log_named_uint("withdraw gas", gasUsed);

        // Assert gas bound
        assertLt(gasUsed, 50_000, "withdraw too expensive");
    }
}
```

## Common Gas Optimizations

| Optimization | Gas Saved | Risk |
|-------------|-----------|------|
| `calldata` over `memory` for external args | 200-2000 | None |
| Pack storage (multiple vars in one slot) | 2100 per cold SLOAD | Readability |
| Use `uint256` over smaller uints | 0-30 per operation | None |
| Unchecked math (where overflow impossible) | 40-100 per op | Must prove safety |
| Cache storage reads in memory | 100 per SLOAD | None |
| Use custom errors over require strings | 200-5000 per revert | Compatibility |
| `immutable` for constructor-set values | 2100 per read | None |

```solidity
// Before: 3 SLOADs
function getInfo() external view returns (uint256, uint256, uint256) {
    return (value1, value2, value3);
}

// After: cache in memory
function getInfo() external view returns (uint256 a, uint256 b, uint256 c) {
    a = value1;
    b = value2;
    c = value3;
}

// Unchecked math where overflow is impossible
function distribute(uint256 total, uint256 share) internal pure returns (uint256) {
    unchecked {
        return total / share; // share is validated > 0 by caller
    }
}
```

## Checklist

- [ ] `.gas-snapshot` committed to repo
- [ ] CI runs `forge snapshot --check` on every PR
- [ ] Tolerance threshold set appropriately (1-5%)
- [ ] Separate gas benchmark tests from functional tests
- [ ] Warm storage slots in setUp before measuring
- [ ] Cold vs warm storage costs differentiated in benchmarks
- [ ] Gas report reviewed for unexpected cost spikes after changes
- [ ] Document accepted gas regression rationale in PR description
