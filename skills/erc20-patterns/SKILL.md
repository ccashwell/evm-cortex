---
name: erc20-patterns
description: Use when implementing, extending, or integrating ERC-20 tokens. Covers standard interface, OpenZeppelin extensions (Permit, Votes, Burnable, Pausable, Capped, Snapshot), common pitfalls (USDT no-return, fee-on-transfer, rebasing), and SafeERC20 usage.
---

# ERC-20 Implementation & Integration Patterns

## Standard Interface (EIP-20)

```solidity
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
```

## OpenZeppelin Base Token

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, ERC20Permit, ERC20Burnable, ERC20Pausable, ERC20Capped, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 cap_
    ) ERC20(name_, symbol_) ERC20Permit(name_) ERC20Capped(cap_) Ownable(msg.sender) {
        _mint(msg.sender, cap_ / 10); // 10% initial supply
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Required overrides for multiple inheritance
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable, ERC20Capped)
    {
        super._update(from, to, value);
    }
}
```

## EIP-2612 Permit (Gasless Approvals)

Permit lets users sign an offchain message instead of calling `approve`, saving gas and enabling single-tx flows:

```solidity
// User signs offchain, relayer submits:
token.permit(owner, spender, value, deadline, v, r, s);
token.transferFrom(owner, spender, value);
```

Always check `deadline` is not in the past. Nonces auto-increment to prevent replay.

## Common Integration Pitfalls

### USDT and Non-Standard Tokens

USDT's `transfer` and `approve` do not return `bool`. Direct `IERC20` calls revert:

```solidity
// WRONG: reverts on USDT
IERC20(usdt).transfer(to, amount);

// RIGHT: use SafeERC20
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
using SafeERC20 for IERC20;

IERC20(usdt).safeTransfer(to, amount);
```

### Fee-on-Transfer Tokens

Some tokens deduct fees during transfer. The received amount is less than the sent amount:

```solidity
uint256 balBefore = token.balanceOf(address(this));
token.safeTransferFrom(msg.sender, address(this), amount);
uint256 received = token.balanceOf(address(this)) - balBefore;
// Use `received`, not `amount`
```

### Rebasing Tokens (stETH, AMPL)

Balances change without transfers. Store shares, not balances:

```solidity
// Wrap rebasing tokens before integrating
uint256 shares = wstETH.wrap(stETHAmount);
// Track shares internally, unwrap on withdrawal
```

### Approve Race Condition

Setting approval from non-zero to non-zero is dangerous. Use `forceApprove`:

```solidity
// SafeERC20 handles this correctly
token.forceApprove(spender, newAmount);
```

## ERC-20 Integration Safety Checklist

- [ ] Use `SafeERC20` for all external token calls
- [ ] Measure actual received amount for fee-on-transfer support
- [ ] Handle tokens with decimals != 18 (USDC = 6, WBTC = 8)
- [ ] Handle tokens that return `false` instead of reverting
- [ ] Handle rebasing tokens (wrap or explicitly exclude)
- [ ] Use `forceApprove` instead of raw `approve` for spending
- [ ] Check for `type(uint256).max` allowance (infinite approval pattern)
- [ ] Validate token address is a contract (`address.code.length > 0`)
- [ ] Consider tokens with blocklists (USDC, USDT can freeze addresses)
- [ ] Never assume `decimals()` exists (it's optional in the spec)

## Votes Extension (Governance Tokens)

```solidity
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

contract GovToken is ERC20, ERC20Permit, ERC20Votes {
    constructor() ERC20("Gov", "GOV") ERC20Permit("Gov") {
        _mint(msg.sender, 1_000_000e18);
    }

    // Users must delegate to activate voting power
    // self-delegate: token.delegate(msg.sender)

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
```

## Testing ERC-20 Contracts

```solidity
function test_transfer_feeOnTransfer() public {
    uint256 balBefore = feeToken.balanceOf(address(vault));
    vm.prank(alice);
    feeToken.transfer(address(vault), 100e18);
    uint256 received = feeToken.balanceOf(address(vault)) - balBefore;
    assertLt(received, 100e18, "fee-on-transfer not accounted for");
}
```
