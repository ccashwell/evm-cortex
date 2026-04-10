---
name: formal-verification
description: Use when applying formal verification to Solidity contracts using Certora CVL or Halmos symbolic testing. Covers specification writing, rule types, ghost variables, hooks, and common verification patterns.
---

# Formal Verification for Solidity

## Tools

| Tool | Approach | Strengths |
|------|----------|-----------|
| Certora Prover | CVL specs + SMT solving | Industry standard, deep analysis |
| Halmos | Symbolic Foundry tests | Familiar Foundry interface, open source |
| KEVM | K Framework semantics | EVM bytecode level verification |

## Certora CVL Specification Template

```cvl
// spec/Vault.spec

using ERC20 as token;

methods {
    function deposit(uint256) external returns (uint256);
    function withdraw(uint256, address, address) external returns (uint256);
    function totalAssets() external returns (uint256) envfree;
    function totalSupply() external returns (uint256) envfree;
    function balanceOf(address) external returns (uint256) envfree;
    function asset() external returns (address) envfree;

    // Summarize external calls
    function _.transfer(address, uint256) external => DISPATCHER(true);
    function _.transferFrom(address, address, uint256) external => DISPATCHER(true);
    function _.balanceOf(address) external => DISPATCHER(true);
}
```

## Rule Types

### Parametric Rules

Verify properties for all possible inputs:

```cvl
// Depositing should increase total supply
rule depositIncreasesSupply(uint256 assets) {
    env e;
    uint256 supplyBefore = totalSupply();

    deposit(e, assets);

    uint256 supplyAfter = totalSupply();
    assert supplyAfter >= supplyBefore, "supply must not decrease on deposit";
}
```

### Invariant Rules

Properties that must hold in every reachable state:

```cvl
// Solvency: vault always has enough assets to back shares
invariant solvency()
    totalSupply() == 0 || totalAssets() > 0
    {
        preserved deposit(uint256 assets) with (env e) {
            require assets > 0;
        }
    }
```

### Relational Rules

Compare two executions:

```cvl
// Monotonicity: depositing more gives more shares
rule depositMonotonicity(uint256 assets1, uint256 assets2) {
    env e;
    require assets1 < assets2;

    storage init = lastStorage;

    uint256 shares1 = deposit(e, assets1);

    uint256 shares2 = deposit(e, assets2) at init;

    assert shares2 >= shares1, "more assets should give more shares";
}
```

## Ghost Variables and Hooks

Track state that isn't directly accessible:

```cvl
ghost mathint sumOfBalances {
    init_state axiom sumOfBalances == 0;
}

hook Sstore balanceOf[KEY address user] uint256 newBalance (uint256 oldBalance) {
    sumOfBalances = sumOfBalances + newBalance - oldBalance;
}

invariant totalSupplyIsSumOfBalances()
    to_mathint(totalSupply()) == sumOfBalances;
```

## Halmos Symbolic Testing

Halmos runs Foundry tests symbolically — inputs are symbolic values, not concrete:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";

contract VaultSymbolicTest is Test, SymTest {
    Vault vault;

    function setUp() public {
        vault = new Vault(address(token));
    }

    /// @notice Verify deposit then withdraw returns at least original amount
    function check_depositWithdrawRoundTrip(uint256 assets) public {
        vm.assume(assets > 0 && assets < type(uint128).max);

        deal(address(token), address(this), assets);
        token.approve(address(vault), assets);

        uint256 shares = vault.deposit(assets, address(this));
        uint256 received = vault.redeem(shares, address(this), address(this));

        // Due to rounding, received should be <= assets
        assert(received <= assets);
    }

    /// @notice No share inflation from direct transfer
    function check_noShareInflation(uint256 donation) public {
        vm.assume(donation > 0 && donation < type(uint128).max);

        uint256 sharesBefore = vault.totalSupply();

        // Direct transfer (donation attack)
        deal(address(token), address(vault), donation);

        uint256 sharesAfter = vault.totalSupply();
        assert(sharesAfter == sharesBefore);
    }
}
```

Run with: `halmos --contract VaultSymbolicTest`

## Common Verification Properties

### ERC20 Properties
```cvl
rule transferIntegrity(address to, uint256 amount) {
    env e;
    address from = e.msg.sender;
    uint256 fromBefore = balanceOf(from);
    uint256 toBefore = balanceOf(to);

    transfer(e, to, amount);

    assert balanceOf(from) == fromBefore - amount;
    assert balanceOf(to) == toBefore + amount;
}
```

### Access Control
```cvl
rule onlyOwnerCanPause() {
    env e;
    require e.msg.sender != owner();

    pause@withrevert(e);

    assert lastReverted, "non-owner should not be able to pause";
}
```

### No Ether Leak
```cvl
invariant noEtherLeak()
    nativeBalances[currentContract] == 0;
```

## Running Certora

```bash
# Install
pip install certora-cli

# Run verification
certoraRun src/Vault.sol \
    --verify Vault:spec/Vault.spec \
    --solc solc8.20 \
    --optimistic_loop \
    --loop_iter 3 \
    --msg "Vault verification"
```

## Checklist

- [ ] Identify critical invariants before writing specs
- [ ] Use `envfree` for view/pure functions (no environment needed)
- [ ] Summarize external calls with `DISPATCHER` or `NONDET`
- [ ] Ghost variables + hooks track aggregate state (sum of balances, etc.)
- [ ] Test specs against known-buggy versions to verify they catch issues
- [ ] Use `preserved` blocks in invariants to add preconditions
- [ ] Halmos tests prefixed with `check_` (not `test_`)
- [ ] Run with `--optimistic_loop` and appropriate `--loop_iter`
- [ ] Review counterexamples in Certora's web UI for false positives
