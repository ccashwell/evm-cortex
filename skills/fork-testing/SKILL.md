---
name: fork-testing
description: Use when testing against live protocol state on mainnet or L2 forks. Covers vm.createFork, account impersonation, block pinning, token dealing, and patterns for DeFi integration testing.
---

# Fork Testing Patterns

## Overview

Fork testing runs your tests against a snapshot of a live blockchain. This lets you test interactions with real deployed contracts (Aave, Uniswap, Chainlink) without deploying mocks.

## Basic Fork Setup

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ForkTest is Test {
    uint256 mainnetFork;

    // Mainnet addresses
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant AAVE_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    function setUp() public {
        // Pin to a specific block for reproducibility
        mainnetFork = vm.createFork(vm.envString("ETH_RPC_URL"), 19_500_000);
        vm.selectFork(mainnetFork);
    }

    function test_forkIsActive() public view {
        assertEq(vm.activeFork(), mainnetFork);
        assertEq(block.number, 19_500_000);
    }
}
```

## RPC Configuration

In `foundry.toml`:
```toml
[rpc_endpoints]
mainnet = "${ETH_RPC_URL}"
arbitrum = "${ARBITRUM_RPC_URL}"
optimism = "${OPTIMISM_RPC_URL}"
base = "${BASE_RPC_URL}"
```

Usage: `vm.createFork("mainnet", blockNumber)`

## Impersonating Accounts

```solidity
// Impersonate a whale to get tokens
address USDC_WHALE = 0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503; // Binance

function test_impersonateWhale() public {
    vm.prank(USDC_WHALE);
    IERC20(USDC).transfer(address(this), 1_000_000e6);
    assertEq(IERC20(USDC).balanceOf(address(this)), 1_000_000e6);
}
```

## Dealing Tokens

```solidity
// deal() writes directly to storage — works for standard ERC20s
function test_dealTokens() public {
    deal(USDC, address(this), 1_000_000e6);
    assertEq(IERC20(USDC).balanceOf(address(this)), 1_000_000e6);

    // For tokens with non-standard storage (e.g., USDT):
    deal(USDC, address(this), 1_000_000e6, true); // true = adjust totalSupply
}

// For complex tokens where deal() fails, impersonate a holder:
function _getTokens(address token, uint256 amount, address to) internal {
    address whale = _findWhale(token);
    vm.prank(whale);
    IERC20(token).transfer(to, amount);
}
```

## DeFi Integration Test Pattern

```solidity
contract AaveForkedTest is Test {
    IPool constant pool = IPool(0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2);

    function setUp() public {
        vm.createSelectFork("mainnet", 19_500_000);
    }

    function test_supplyAndBorrow() public {
        address user = makeAddr("user");

        // Give user WETH collateral
        deal(WETH, user, 10 ether);

        vm.startPrank(user);

        // Supply WETH as collateral
        IERC20(WETH).approve(address(pool), 10 ether);
        pool.supply(WETH, 10 ether, user, 0);

        // Borrow USDC against WETH
        pool.borrow(USDC, 5_000e6, 2, 0, user);

        assertEq(IERC20(USDC).balanceOf(user), 5_000e6);

        // Check health factor
        (,,,,,uint256 hf) = pool.getUserAccountData(user);
        assertGt(hf, 1e18, "should be healthy");

        vm.stopPrank();
    }

    function test_liquidation() public {
        address borrower = makeAddr("borrower");
        address liquidator = makeAddr("liquidator");

        // Setup underwater position using price manipulation
        _setupUnderwaterPosition(borrower);

        // Liquidate
        deal(USDC, liquidator, 10_000e6);
        vm.startPrank(liquidator);
        IERC20(USDC).approve(address(pool), 10_000e6);
        pool.liquidationCall(WETH, USDC, borrower, 5_000e6, false);
        vm.stopPrank();

        // Verify liquidator received collateral
        assertGt(IERC20(WETH).balanceOf(liquidator), 0);
    }
}
```

## Multi-Fork Testing

Test cross-chain interactions:

```solidity
function test_crossChainState() public {
    uint256 mainnetFork = vm.createFork("mainnet");
    uint256 arbitrumFork = vm.createFork("arbitrum");

    // Check mainnet state
    vm.selectFork(mainnetFork);
    uint256 mainnetBalance = IERC20(USDC).totalSupply();

    // Check Arbitrum state
    vm.selectFork(arbitrumFork);
    address ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    uint256 arbBalance = IERC20(ARB_USDC).totalSupply();

    // Contracts deployed on a fork persist only on that fork
    vm.selectFork(mainnetFork);
    MyBridge bridge = new MyBridge();
    // bridge only exists on mainnetFork
}
```

## Price Manipulation for Testing

```solidity
// Mock Chainlink feed to simulate price crash
function _crashPrice(address feed, int256 newPrice) internal {
    // Find the storage slot for the latest answer
    // Or use vm.mockCall:
    vm.mockCall(
        feed,
        abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
        abi.encode(uint80(1), newPrice, block.timestamp, block.timestamp, uint80(1))
    );
}
```

## Running Fork Tests

```bash
# Run all fork tests
forge test --fork-url $ETH_RPC_URL

# Run with specific block
forge test --fork-url $ETH_RPC_URL --fork-block-number 19500000

# Only fork tests (convention: separate test directory)
forge test --match-path "test/fork/*" --fork-url $ETH_RPC_URL

# Cache RPC calls for speed
forge test --fork-url $ETH_RPC_URL --fork-block-number 19500000
# Foundry auto-caches in ~/.foundry/cache/rpc/
```

## Checklist

- [ ] Pin fork to specific block number for reproducibility
- [ ] Use `vm.envString()` for RPC URLs (never hardcode)
- [ ] Prefer `deal()` over whale impersonation when possible
- [ ] Label all addresses for readable stack traces
- [ ] Cache fork data by pinning block numbers
- [ ] Test both happy path and failure modes (liquidation, oracle failure)
- [ ] Mock external calls only when necessary (prefer real state)
- [ ] CI uses cached RPC or a dedicated node for reliability
- [ ] Document which mainnet block and why it was chosen
