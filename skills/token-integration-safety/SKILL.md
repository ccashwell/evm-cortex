---
name: token-integration-safety
description: Safe integration patterns for non-standard ERC-20 tokens. Use when building protocols that accept arbitrary tokens. Covers USDT (no return value), USDC (6 decimals, blacklist), fee-on-transfer, rebasing tokens, ERC-777 callbacks, pausable tokens, and Permit2.
---

# Token Integration Safety

## Always Use SafeERC20

This is the single most important rule. Never call `transfer`, `transferFrom`, or `approve` directly.

```solidity
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Vault {
    using SafeERC20 for IERC20;

    function deposit(IERC20 token, uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(IERC20 token, uint256 amount) external {
        token.safeTransfer(msg.sender, amount);
    }

    function approve(IERC20 token, address spender, uint256 amount) external {
        token.forceApprove(spender, amount);
    }
}
```

## USDT — No Return Value

USDT's `transfer()` and `transferFrom()` don't return a `bool`. Direct calls via the `IERC20` interface will revert because Solidity expects return data.

```solidity
// BROKEN with USDT:
IERC20(usdt).transfer(to, amount); // reverts — no return data

// WORKS with USDT:
IERC20(usdt).safeTransfer(to, amount); // SafeERC20 handles missing return
```

USDT also requires approval to be set to 0 before changing to a non-zero value:

```solidity
// BROKEN with USDT:
IERC20(usdt).approve(spender, newAmount); // reverts if current approval != 0

// WORKS with USDT:
IERC20(usdt).forceApprove(spender, newAmount); // sets to 0 first, then newAmount
```

## USDC — 6 Decimals and Blacklist

```solidity
// USDC uses 6 decimals, not 18
// 1 USDC = 1_000_000 (1e6), NOT 1e18

// VULNERABLE: hardcoded 18 decimals
uint256 usdcAmount = ethAmount * ethPrice / 1e18; // wrong!

// SAFE: use actual decimals
uint8 decimals = IERC20Metadata(address(usdc)).decimals(); // returns 6
uint256 usdcAmount = ethAmount * ethPrice / (10 ** (18 - decimals + 18));
```

USDC has a blacklist. Blacklisted addresses cannot send or receive USDC. Your protocol must handle transfer failures gracefully.

```solidity
// If a blacklisted user has funds in your vault, they cannot withdraw
// Consider: allow withdrawal to a different address (with proper auth)
function withdrawTo(address token, address recipient, uint256 amount) external {
    if (balances[msg.sender] < amount) revert InsufficientBalance();
    balances[msg.sender] -= amount;
    IERC20(token).safeTransfer(recipient, amount);
}
```

## Fee-on-Transfer Tokens

Some tokens deduct a fee on every transfer. The received amount is less than the sent amount.

```solidity
// VULNERABLE: assumes received amount equals sent amount
function deposit(IERC20 token, uint256 amount) external {
    token.safeTransferFrom(msg.sender, address(this), amount);
    balances[msg.sender] += amount; // WRONG: received less than amount
}

// SAFE: measure actual received amount
function deposit(IERC20 token, uint256 amount) external {
    uint256 balanceBefore = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = token.balanceOf(address(this)) - balanceBefore;

    balances[msg.sender] += received;
    emit Deposited(msg.sender, address(token), received);
}
```

**Decision**: Many protocols explicitly reject fee-on-transfer tokens for simplicity. Document this clearly if so.

## Rebasing Tokens (stETH, aTokens)

Rebasing tokens change balances automatically. `balanceOf()` returns different values over time without transfers.

```solidity
// PROBLEM: stored balance becomes stale
mapping(address => uint256) public balances;

function deposit(uint256 amount) external {
    stETH.safeTransferFrom(msg.sender, address(this), amount);
    balances[msg.sender] += amount; // balance will change via rebasing
}

// SOLUTION 1: Use the wrapped, non-rebasing version
// stETH → wstETH (wrapped stETH, non-rebasing)
// aUSDC → use share-based accounting internally

// SOLUTION 2: Share-based accounting (ERC-4626 pattern)
function deposit(uint256 assets) external returns (uint256 shares) {
    shares = convertToShares(assets);
    _mint(msg.sender, shares);
    stETH.safeTransferFrom(msg.sender, address(this), assets);
}
```

## ERC-777 Callbacks

ERC-777 tokens call `tokensToSend()` on the sender and `tokensReceived()` on the recipient. This creates reentrancy vectors.

```solidity
// Risk: any transfer of an ERC-777 token triggers a callback
// If your contract receives an ERC-777 token, tokensReceived() is called
// An attacker can exploit this callback for reentrancy

// Defense: ReentrancyGuard on all functions that transfer tokens
function deposit(IERC20 token, uint256 amount) external nonReentrant {
    token.safeTransferFrom(msg.sender, address(this), amount);
    _updateBalance(msg.sender, amount);
}
```

## Tokens with Blocklists

USDC, USDT, and others can freeze/blocklist addresses. Your protocol should handle this.

```solidity
// Consider: what happens if a user gets blocklisted after depositing?
// - They can't receive tokens back
// - Their position may become unliquidatable
// - Protocol accounting may break

// Mitigation: allow withdrawal to alternative addresses
// Mitigation: allow admin rescue for stuck funds (with timelock)
```

## Pausable Tokens

Some tokens (USDC, USDT) can be paused globally by their admin, blocking all transfers.

```solidity
// If the underlying token is paused:
// - deposits fail
// - withdrawals fail
// - liquidations fail (potentially dangerous)

// Mitigation: emergency mode that accounts for paused underlying
// Mitigation: alternative settlement paths
```

## Permit2 Integration

Permit2 provides a universal approval mechanism for all ERC-20 tokens (even those without EIP-2612).

```solidity
import {IPermit2} from "permit2/interfaces/IPermit2.sol";

contract VaultWithPermit2 {
    IPermit2 public immutable PERMIT2;

    function depositWithPermit2(
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        PERMIT2.permitTransferFrom(
            IPermit2.PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({token: token, amount: amount}),
                nonce: nonce,
                deadline: deadline
            }),
            IPermit2.SignatureTransferDetails({
                to: address(this),
                requestedAmount: amount
            }),
            msg.sender,
            signature
        );

        _recordDeposit(msg.sender, token, amount);
    }
}
```

## Token Quirks Reference

| Token | Decimals | Return Bool | Blocklist | Pausable | Fee-on-Transfer | Rebasing |
|-------|----------|-------------|-----------|----------|-----------------|----------|
| USDT | 6 | No | Yes | Yes | No | No |
| USDC | 6 | Yes | Yes | Yes | No | No |
| DAI | 18 | Yes | No | No | No | No |
| WETH | 18 | Yes | No | No | No | No |
| WBTC | 8 | Yes | No | No | No | No |
| stETH | 18 | Yes | No | No | No | Yes |
| PAXG | 18 | Yes | Yes | Yes | Yes (0.02%) | No |

## Token Integration Checklist

- [ ] SafeERC20 used for all token operations
- [ ] `forceApprove` used instead of `approve` (USDT compatibility)
- [ ] No assumption of 18 decimals — query `decimals()`
- [ ] Fee-on-transfer handled (measure balance diff) or explicitly rejected
- [ ] Rebasing tokens: use wrapped version or share-based accounting
- [ ] ERC-777 callbacks: ReentrancyGuard on all token-handling functions
- [ ] Blocklist handling: alternative withdrawal paths
- [ ] Pausable token failure paths considered
- [ ] Permit2 supported for gasless approvals
- [ ] Token behavior documented in protocol docs
