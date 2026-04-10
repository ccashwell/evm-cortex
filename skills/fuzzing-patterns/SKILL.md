---
name: fuzzing-patterns
description: Use when writing fuzz tests for Solidity contracts. Covers property-based testing, input constraining with vm.assume/vm.bound, stateful vs stateless fuzzing, configuring runs, seed corpus, and interpreting counterexamples.
---

# Fuzz Testing Patterns

## Stateless vs Stateful Fuzzing

| Type | How It Works | Use Case |
|------|-------------|----------|
| **Stateless** | Random inputs per test, fresh state each run | Individual function properties |
| **Stateful** | Random sequences of calls, accumulated state | System-level invariants |

Stateless = `function testFuzz_*(uint256 x)` — Foundry randomizes `x` each run.
Stateful = invariant tests with handlers (see `invariant-testing` skill).

## Basic Fuzz Test

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";

contract VaultFuzzTest is Test {
    Vault vault;

    function setUp() public {
        vault = new Vault(address(token));
        deal(address(token), address(this), type(uint128).max);
        token.approve(address(vault), type(uint256).max);
    }

    // Property: deposit then redeem never yields more than deposited
    function testFuzz_depositRedeemNoProfit(uint256 assets) public {
        assets = bound(assets, 1, type(uint128).max);

        uint256 shares = vault.deposit(assets, address(this));
        uint256 received = vault.redeem(shares, address(this), address(this));

        assertLe(received, assets, "profit from round-trip");
    }

    // Property: transfer preserves total supply
    function testFuzz_transferPreservesSupply(
        address to,
        uint256 mintAmount,
        uint256 transferAmount
    ) public {
        vm.assume(to != address(0) && to != address(this));
        mintAmount = bound(mintAmount, 1, type(uint128).max);
        transferAmount = bound(transferAmount, 0, mintAmount);

        vault.deposit(mintAmount, address(this));
        uint256 supplyBefore = vault.totalSupply();

        vault.transfer(to, transferAmount);
        uint256 supplyAfter = vault.totalSupply();

        assertEq(supplyBefore, supplyAfter, "supply changed on transfer");
    }
}
```

## Input Constraining

### `bound()` vs `vm.assume()`

```solidity
// PREFER bound() — maps input to valid range without discarding runs
function testFuzz_bounded(uint256 x) public {
    x = bound(x, 1e18, 1_000_000e18);
    // x is always in [1e18, 1_000_000e18]
}

// AVOID vm.assume() for wide ranges — discards too many inputs
function testFuzz_assumed(uint256 x) public {
    vm.assume(x > 0 && x < 1000); // 99.99% of inputs discarded!
    // Only use for conditions that are hard to express with bound()
}
```

### When to Use `vm.assume()`

```solidity
// Valid: exclude specific addresses
function testFuzz_transfer(address to, uint256 amount) public {
    vm.assume(to != address(0));
    vm.assume(to != address(vault));
    vm.assume(to.code.length == 0); // no contracts
    amount = bound(amount, 1, balanceOf(address(this)));
    // ...
}
```

## Fuzz Configuration

In `foundry.toml`:
```toml
[fuzz]
runs = 1000            # number of random inputs per test (default: 256)
max_test_rejects = 65536  # max vm.assume rejections before fail
seed = "0x1234"        # fixed seed for reproducibility
dictionary_weight = 40  # % of inputs from extracted constants

[invariant]
runs = 256
depth = 64
fail_on_revert = false
```

## Property Categories

### Algebraic Properties
```solidity
// Commutativity: f(a, b) == f(b, a)
function testFuzz_addCommutative(uint256 a, uint256 b) public {
    assertEq(target.add(a, b), target.add(b, a));
}

// Associativity: f(f(a, b), c) == f(a, f(b, c))
// Identity: f(a, 0) == a
// Idempotency: f(f(a)) == f(a)
```

### Roundtrip Properties
```solidity
// encode then decode returns original
function testFuzz_encodeDecodeRoundtrip(uint256 value) public {
    bytes memory encoded = target.encode(value);
    uint256 decoded = target.decode(encoded);
    assertEq(decoded, value);
}

// deposit then withdraw returns (approximately) original
function testFuzz_depositWithdrawRoundtrip(uint256 amount) public {
    amount = bound(amount, 1e18, 1_000_000e18);
    uint256 shares = vault.deposit(amount, address(this));
    uint256 returned = vault.redeem(shares, address(this), address(this));
    assertApproxEqAbs(returned, amount, 1); // within 1 wei
}
```

### Monotonicity Properties
```solidity
// More input -> more output (or equal)
function testFuzz_depositMonotonic(uint256 a, uint256 b) public {
    a = bound(a, 1e18, 1_000_000e18);
    b = bound(b, a, 1_000_000e18); // b >= a

    uint256 sharesA = vault.previewDeposit(a);
    uint256 sharesB = vault.previewDeposit(b);
    assertGe(sharesB, sharesA, "more deposit should give more shares");
}
```

### Boundary Properties
```solidity
// No overflow at max values
function testFuzz_noOverflow(uint256 a, uint256 b) public {
    a = bound(a, 0, type(uint128).max);
    b = bound(b, 0, type(uint128).max);
    // Should not revert with overflow
    target.safeMultiply(a, b);
}
```

## Interpreting Counterexamples

When a fuzz test fails, Foundry shows the failing input:

```
[FAIL. Reason: profit from round-trip]
    Counterexample: calldata=0x..., args=[115792089237316195423570985008687907853269984665640564039457584007913129639935]
```

Steps:
1. Copy the failing args into a concrete test
2. Add `console2.log()` to trace execution
3. Check if it's a real bug or a test constraint issue
4. If real: fix the bug, keep the counterexample as a regression test
5. If false positive: tighten `bound()` constraints

```solidity
// Regression test from fuzzer counterexample
function test_regression_overflowOnMaxDeposit() public {
    uint256 amount = type(uint256).max;
    vm.expectRevert();
    vault.deposit(amount, address(this));
}
```

## Checklist

- [ ] Use `bound()` over `vm.assume()` to minimize discarded runs
- [ ] Properties categorized: algebraic, roundtrip, monotonicity, boundary
- [ ] Fuzz runs set to 1000+ for CI, 256 for local development
- [ ] Counterexamples from failures preserved as regression tests
- [ ] Fixed seed used for reproducible CI results
- [ ] Separate fuzz tests from unit tests (naming convention `testFuzz_`)
- [ ] Edge values tested explicitly alongside fuzzing (0, 1, max)
- [ ] Properties verified against known-correct reference implementation
