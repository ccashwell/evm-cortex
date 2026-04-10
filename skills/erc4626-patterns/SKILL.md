---
name: erc4626-patterns
description: Use when building tokenized vaults with ERC-4626. Covers deposit/mint/withdraw/redeem, share math, rounding rules, first depositor attack mitigation, yield strategies, and integration patterns.
---

# ERC-4626 Tokenized Vault Patterns

## Core Interface

ERC-4626 standardizes yield-bearing vaults. Users deposit assets and receive shares:

```solidity
interface IERC4626 is IERC20 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);

    // Deposit flow: user specifies assets
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function mint(uint256 shares, address receiver) external returns (uint256 assets);

    // Withdraw flow: user specifies assets or shares
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    // Preview functions (simulate without executing)
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewMint(uint256 shares) external view returns (uint256 assets);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);

    // Limits
    function maxDeposit(address receiver) external view returns (uint256);
    function maxMint(address receiver) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);

    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}
```

## Secure Implementation with Virtual Shares

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SecureVault is ERC4626 {
    using SafeERC20 for IERC20;

    constructor(IERC20 asset_)
        ERC4626(asset_)
        ERC20("Vault Shares", "vASSET")
    {}

    /// @dev OpenZeppelin ERC4626 already uses virtual shares/assets
    /// (decimalsOffset = 0 by default, but _decimalsOffset() can be overridden).
    /// Override to add +3 offset for first-depositor attack mitigation:
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }
}
```

## Share Math and Rounding Rules

The fundamental equation: `shares * totalAssets == assets * totalSupply`

```
shares = assets * totalSupply / totalAssets   (deposit, round DOWN → favor vault)
assets = shares * totalAssets / totalSupply    (redeem, round DOWN → favor vault)
```

**Rounding convention** (always favor the vault to prevent rounding exploits):

| Operation | User sends | User receives | Round |
|-----------|-----------|---------------|-------|
| deposit | assets | shares | DOWN (fewer shares) |
| mint | assets | shares | UP (more assets) |
| withdraw | shares | assets | UP (more shares burned) |
| redeem | shares | assets | DOWN (fewer assets) |

```solidity
// OpenZeppelin handles rounding internally:
function _convertToShares(uint256 assets, Math.Rounding rounding)
    internal view virtual returns (uint256)
{
    return assets.mulDiv(totalSupply() + 10 ** _decimalsOffset(), totalAssets() + 1, rounding);
}
```

## First Depositor Attack Mitigation

The attack: first depositor mints 1 share, then donates large amount of assets directly to the vault. Subsequent depositors get 0 shares due to rounding.

**Solution 1: Virtual shares/assets (recommended)**

OpenZeppelin adds virtual offset to prevent manipulation:

```solidity
function _decimalsOffset() internal pure override returns (uint8) {
    return 3; // 1000 virtual shares — cost of attack becomes prohibitive
}
```

**Solution 2: Dead shares on first deposit**

```solidity
function _afterDeposit(uint256 assets, uint256 shares) internal virtual {
    if (totalSupply() == shares) {
        // First deposit: burn minimum shares to address(1)
        uint256 deadShares = 10 ** decimals() / 1000;
        _mint(address(1), deadShares);
    }
}
```

## Yield Strategy Integration

```solidity
contract YieldVault is ERC4626 {
    ILendingPool public immutable lendingPool;

    constructor(IERC20 asset_, ILendingPool pool_)
        ERC4626(asset_) ERC20("Yield Vault", "yASSET")
    {
        lendingPool = pool_;
        asset_.approve(address(pool_), type(uint256).max);
    }

    function totalAssets() public view override returns (uint256) {
        return lendingPool.balanceOf(address(this));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal override
    {
        super._deposit(caller, receiver, assets, shares);
        IERC20(asset()).safeTransfer(address(lendingPool), assets);
        lendingPool.deposit(assets);
    }

    function _withdraw(
        address caller, address receiver, address owner, uint256 assets, uint256 shares
    ) internal override {
        lendingPool.withdraw(assets);
        super._withdraw(caller, receiver, owner, assets, shares);
    }
}
```

## Max Functions and Access Control

```solidity
// Pausable vault example
function maxDeposit(address) public view override returns (uint256) {
    return paused() ? 0 : type(uint256).max;
}

function maxMint(address) public view override returns (uint256) {
    return paused() ? 0 : type(uint256).max;
}

// Deposit caps
uint256 public depositCap;

function maxDeposit(address) public view override returns (uint256) {
    uint256 remaining = depositCap > totalAssets() ? depositCap - totalAssets() : 0;
    return paused() ? 0 : remaining;
}
```

## Testing ERC-4626

```solidity
function test_depositAndRedeem_roundTrip() public {
    uint256 assets = 1e18;
    deal(address(token), alice, assets);

    vm.startPrank(alice);
    token.approve(address(vault), assets);
    uint256 shares = vault.deposit(assets, alice);

    assertEq(vault.balanceOf(alice), shares);
    assertEq(vault.convertToAssets(shares), assets);

    uint256 redeemed = vault.redeem(shares, alice, alice);
    assertEq(redeemed, assets);
    vm.stopPrank();
}

function test_previewMatchesActual() public {
    uint256 assets = 1e18;
    uint256 previewShares = vault.previewDeposit(assets);

    deal(address(token), alice, assets);
    vm.startPrank(alice);
    token.approve(address(vault), assets);
    uint256 actualShares = vault.deposit(assets, alice);
    vm.stopPrank();

    assertEq(actualShares, previewShares, "Preview must match actual");
}
```

## Security Checklist

- [ ] Use virtual shares (`_decimalsOffset >= 3`) to prevent first depositor attack
- [ ] Rounding always favors the vault (never the user)
- [ ] Preview functions are accurate (match actual operations)
- [ ] `totalAssets` cannot be manipulated via direct token transfers
- [ ] Max functions return 0 when vault is paused or at capacity
- [ ] Handle fee-on-transfer tokens if supported
- [ ] Reentrancy guards on deposit/withdraw (especially with external protocol calls)
- [ ] Test with zero deposits, dust amounts, and very large amounts
