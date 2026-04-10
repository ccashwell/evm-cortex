---
name: invariant-testing
description: Use when writing Foundry invariant (stateful fuzz) tests. Covers handler contracts, ghost variables, target configuration, common invariant patterns, and handler design for DeFi protocols.
---

# Foundry Invariant Testing

## Overview

Invariant tests execute random sequences of function calls against handler contracts and assert that system invariants hold after every call. Unlike stateless fuzz tests, invariant tests maintain state across calls, exploring complex state transitions.

## Configuration

In `foundry.toml`:
```toml
[invariant]
runs = 256          # number of random sequences
depth = 64          # calls per sequence
fail_on_revert = false  # don't fail on handler reverts (expected)
```

## Handler Contract Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Vault} from "../../src/Vault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract VaultHandler is CommonBase, StdCheats, StdUtils {
    Vault public vault;
    IERC20 public token;

    // Ghost variables track expected state
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalWithdrawn;
    mapping(address => uint256) public ghost_userDeposits;

    // Actors for randomized msg.sender
    address[] public actors;
    address internal currentActor;

    modifier useActor(uint256 actorIndexSeed) {
        currentActor = actors[bound(actorIndexSeed, 0, actors.length - 1)];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    constructor(Vault _vault, IERC20 _token) {
        vault = _vault;
        token = _token;

        // Create actor pool
        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0x1000 + i));
            actors.push(actor);
            deal(address(token), actor, 1_000_000e18);
            vm.prank(actor);
            token.approve(address(vault), type(uint256).max);
        }
    }

    function deposit(uint256 actorSeed, uint256 amount) external useActor(actorSeed) {
        amount = bound(amount, 1e18, 100_000e18);

        uint256 balance = token.balanceOf(currentActor);
        if (balance < amount) return; // skip if insufficient

        vault.deposit(amount);

        ghost_totalDeposited += amount;
        ghost_userDeposits[currentActor] += amount;
    }

    function withdraw(uint256 actorSeed, uint256 amount) external useActor(actorSeed) {
        uint256 staked = vault.balanceOf(currentActor);
        if (staked == 0) return; // skip if nothing to withdraw

        amount = bound(amount, 1, staked);

        vault.withdraw(amount);

        ghost_totalWithdrawn += amount;
        ghost_userDeposits[currentActor] -= amount;
    }

    function warpTime(uint256 seconds_) external {
        seconds_ = bound(seconds_, 1, 7 days);
        skip(seconds_);
    }
}
```

## Invariant Test File

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {VaultHandler} from "./handlers/VaultHandler.sol";

contract VaultInvariantTest is Test {
    Vault public vault;
    MockERC20 public token;
    VaultHandler public handler;

    function setUp() public {
        token = new MockERC20("Token", "TKN", 18);
        vault = new Vault(address(token));
        handler = new VaultHandler(vault, token);

        // Only target the handler — never call vault directly
        targetContract(address(handler));
    }

    /// @dev Total shares == total deposits - total withdrawals
    function invariant_solvency() public view {
        assertGe(
            token.balanceOf(address(vault)),
            handler.ghost_totalDeposited() - handler.ghost_totalWithdrawn(),
            "vault is insolvent"
        );
    }

    /// @dev Vault token balance >= total supply of shares
    function invariant_sharesBacked() public view {
        uint256 totalShares = vault.totalSupply();
        uint256 totalAssets = token.balanceOf(address(vault));
        if (totalShares > 0) {
            assertGt(totalAssets, 0, "shares exist but no assets");
        }
    }

    /// @dev No individual user has more shares than total supply
    function invariant_noShareInflation() public view {
        address[] memory actors = _getActors();
        uint256 totalSupply = vault.totalSupply();
        for (uint256 i = 0; i < actors.length; i++) {
            assertLe(vault.balanceOf(actors[i]), totalSupply);
        }
    }

    /// @dev Ghost tracking matches actual state
    function invariant_ghostAccuracy() public view {
        uint256 expectedVaultBalance =
            handler.ghost_totalDeposited() - handler.ghost_totalWithdrawn();
        assertEq(
            token.balanceOf(address(vault)),
            expectedVaultBalance,
            "ghost tracking diverged"
        );
    }

    function _getActors() internal view returns (address[] memory) {
        address[] memory actors = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            actors[i] = handler.actors(i);
        }
        return actors;
    }
}
```

## Common DeFi Invariants

### Lending Protocol
```solidity
function invariant_totalDebtLeTotalSupply() public view {
    assertLe(pool.totalDebt(), pool.totalSupply());
}
function invariant_allPositionsCollateralized() public view {
    // For each borrower, collateral * LTV >= debt
}
```

### AMM / DEX
```solidity
function invariant_constantProduct() public view {
    uint256 k = pool.reserve0() * pool.reserve1();
    assertGe(k, initialK, "k decreased"); // k should only increase (fees)
}
function invariant_lpTokensBacked() public view {
    // LP tokens redeemable for proportional reserves
}
```

### Staking
```solidity
function invariant_rewardsSolvent() public view {
    assertGe(rewardToken.balanceOf(address(staking)), staking.totalPendingRewards());
}
function invariant_totalStakedMatchesSum() public view {
    uint256 sum = 0;
    for (uint256 i = 0; i < actors.length; i++) {
        sum += staking.balanceOf(actors[i]);
    }
    assertEq(sum, staking.totalSupply());
}
```

## Target Configuration

```solidity
// Target specific contract
targetContract(address(handler));

// Target specific functions (exclude admin/setup)
bytes4[] memory selectors = new bytes4[](3);
selectors[0] = VaultHandler.deposit.selector;
selectors[1] = VaultHandler.withdraw.selector;
selectors[2] = VaultHandler.warpTime.selector;
targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));

// Exclude senders
excludeSender(address(vault)); // don't call as the vault itself
```

## Checklist

- [ ] Handler wraps all user-facing functions with input bounding
- [ ] Ghost variables track expected state changes
- [ ] Actor pool covers multiple users with pre-approved balances
- [ ] `bound()` constrains all numeric inputs to valid ranges
- [ ] Handler functions silently return on invalid preconditions (don't revert)
- [ ] `targetContract()` points to handler, not the system under test
- [ ] Invariant functions start with `invariant_` prefix
- [ ] Time progression handler included for time-dependent protocols
- [ ] Run with sufficient depth (64+) and runs (256+) for confidence
