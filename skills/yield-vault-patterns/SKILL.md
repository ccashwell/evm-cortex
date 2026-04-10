---
name: yield-vault-patterns
description: Use when building ERC-4626 tokenized vaults, yield aggregators, or share-based deposit/withdraw systems. Covers share math, rounding, first depositor attack mitigation, and complete implementation patterns.
---

# ERC-4626 Tokenized Vault Patterns

## Overview

ERC-4626 standardizes yield-bearing vaults. Depositors receive shares proportional to their deposit. Shares appreciate as the vault earns yield.

**Core Invariant**: `shares * totalAssets / totalShares = user's assets`

## Share Price Math

```
deposit:   shares = assets * totalSupply / totalAssets    (round DOWN)
mint:      assets = shares * totalAssets / totalSupply     (round UP)
withdraw:  shares = assets * totalSupply / totalAssets     (round UP)
redeem:    assets = shares * totalAssets / totalSupply     (round DOWN)
```

**Rounding rule**: Always round in favor of the vault (against the user) to prevent value extraction.

## Complete ERC-4626 Implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

contract YieldVault is ERC20, IERC4626 {
    using SafeERC20 for IERC20;
    using Math for uint256;

    IERC20 public immutable asset_;
    uint8 private immutable _decimals;

    // Virtual shares/assets to prevent first depositor attack
    uint256 internal constant VIRTUAL_SHARES = 1e3;
    uint256 internal constant VIRTUAL_ASSETS = 1;

    constructor(IERC20 _asset, string memory name, string memory symbol)
        ERC20(name, symbol)
    {
        asset_ = _asset;
        _decimals = ERC20(address(_asset)).decimals();
    }

    function asset() external view returns (address) { return address(asset_); }
    function decimals() public view override returns (uint8) { return _decimals; }

    function totalAssets() public view returns (uint256) {
        return asset_.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets.mulDiv(
            totalSupply() + VIRTUAL_SHARES,
            totalAssets() + VIRTUAL_ASSETS,
            Math.Rounding.Floor
        );
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares.mulDiv(
            totalAssets() + VIRTUAL_ASSETS,
            totalSupply() + VIRTUAL_SHARES,
            Math.Rounding.Floor
        );
    }

    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        return convertToAssets(balanceOf(owner));
    }

    function maxRedeem(address owner) external view returns (uint256) {
        return balanceOf(owner);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return shares.mulDiv(
            totalAssets() + VIRTUAL_ASSETS,
            totalSupply() + VIRTUAL_SHARES,
            Math.Rounding.Ceil // round UP against user
        );
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return assets.mulDiv(
            totalSupply() + VIRTUAL_SHARES,
            totalAssets() + VIRTUAL_ASSETS,
            Math.Rounding.Ceil // round UP against user
        );
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = previewDeposit(assets);
        require(shares > 0, "zero shares");
        asset_.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        assets = previewMint(shares);
        asset_.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        external returns (uint256 shares)
    {
        shares = previewWithdraw(assets);
        if (msg.sender != owner_) {
            _spendAllowance(owner_, msg.sender, shares);
        }
        _burn(owner_, shares);
        asset_.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        external returns (uint256 assets)
    {
        assets = previewRedeem(shares);
        if (msg.sender != owner_) {
            _spendAllowance(owner_, msg.sender, shares);
        }
        _burn(owner_, shares);
        asset_.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
    }
}
```

## First Depositor Attack Mitigation

Without protection, an attacker can:
1. Deposit 1 wei to get 1 share
2. Donate a large amount directly to inflate `totalAssets`
3. Next depositor gets 0 shares due to rounding

**Virtual shares/assets** solve this by ensuring the exchange rate always has a floor:

```solidity
uint256 internal constant VIRTUAL_SHARES = 1e3;
uint256 internal constant VIRTUAL_ASSETS = 1;

// Share calculation uses (totalSupply + VIRTUAL_SHARES) / (totalAssets + VIRTUAL_ASSETS)
// Cost of attack = VIRTUAL_SHARES * donation_amount / VIRTUAL_ASSETS
```

OpenZeppelin's ERC4626 uses `_decimalsOffset()` which is equivalent.

## Yield Strategy Integration

```solidity
function totalAssets() public view override returns (uint256) {
    // Include assets deployed to yield strategies
    return asset_.balanceOf(address(this)) + _deployedAssets();
}

function harvest() external {
    // Collect yield from strategy, increasing totalAssets
    // Share price automatically increases for all holders
    strategy.claim();
}
```

## Checklist

- [ ] Round DOWN for `deposit` and `redeem` (favors vault)
- [ ] Round UP for `mint` and `withdraw` (favors vault)
- [ ] Implement first depositor attack mitigation (virtual shares or minimum deposit)
- [ ] `totalAssets()` includes all assets under management (not just balance)
- [ ] `preview*` functions match actual execution (same rounding)
- [ ] `max*` functions account for strategy liquidity limits
- [ ] Handle ERC-20 tokens with non-standard decimals
- [ ] Test share price manipulation via direct token transfers
- [ ] Emit `Deposit` and `Withdraw` events per spec
