---
name: reentrancy-patterns
description: Comprehensive reentrancy attack patterns and defenses for Solidity. Use when writing contracts with external calls, integrating tokens with callbacks (ERC-777, ERC-1363), or auditing for reentrancy vulnerabilities. Covers all variants including read-only reentrancy.
---

# Reentrancy Patterns

## Single-Function Reentrancy

The classic variant. An external call re-enters the same function before state is updated.

```solidity
// VULNERABLE: state update after external call
contract VulnerableVault {
    mapping(address => uint256) public balances;

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount);

        (bool success,) = msg.sender.call{value: amount}(""); // ← re-entry point
        require(success);

        balances[msg.sender] -= amount; // ← too late, attacker already re-entered
    }
}

// FIXED: checks-effects-interactions
contract FixedVault {
    mapping(address => uint256) public balances;

    function withdraw(uint256 amount) external {
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount; // effect BEFORE interaction

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
```

## Cross-Function Reentrancy

Attacker re-enters a **different** function that reads stale state.

```solidity
// VULNERABLE: withdraw and transfer share state
contract Vulnerable {
    mapping(address => uint256) public balances;

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount);
        (bool success,) = msg.sender.call{value: amount}(""); // ← attacker calls transfer() here
        require(success);
        balances[msg.sender] -= amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balances[msg.sender] >= amount);
        balances[msg.sender] -= amount; // uses stale balance
        balances[to] += amount;
    }
}
```

**Defense**: ReentrancyGuard on all functions sharing state, plus CEI ordering.

## Cross-Contract Reentrancy

Attacker re-enters a different contract that reads stale state from the first.

```solidity
// Contract A: Lending pool that updates user balance
// Contract B: Reads user balance from A for collateral check
// Attack: Borrow from A → callback during withdrawal → B reads stale (higher) balance → over-borrow

// Defense: ReentrancyGuard + cross-contract state synchronization
// OR: use a protocol-wide reentrancy lock
```

### Protocol-Wide Reentrancy Lock

```solidity
contract ReentrancyLock {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    error ReentrancyGuard_ReentrantCall();

    modifier globalNonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuard_ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

// All contracts in the protocol inherit from or check the same lock
contract LendingPool is ReentrancyLock {
    function borrow(uint256 amount) external globalNonReentrant { ... }
}

contract CollateralManager is ReentrancyLock {
    function checkCollateral(address user) external globalNonReentrant { ... }
}
```

## Read-Only Reentrancy

The most subtle variant. A view function returns stale state during a callback, and a **different protocol** reads that stale state.

```solidity
// Scenario: Curve pool with removeLiquidity that triggers a callback
// 1. Attacker calls removeLiquidity() on Curve pool
// 2. Curve sends ETH to attacker (callback)
// 3. During callback, pool's internal accounting is stale
// 4. Attacker calls a lending protocol that reads Curve's get_virtual_price()
// 5. Virtual price is inflated (stale state) → attacker borrows more than they should

// Defense in the reading protocol:
function getCollateralValue(address pool) internal view returns (uint256) {
    // Check if the Curve pool is mid-operation
    // Many Curve pools have a reentrancy lock that can be checked
    try ICurvePool(pool).claim_admin_fees() {
        // If this succeeds, pool is not locked — safe to read
    } catch {
        revert PoolReentrant();
    }

    return ICurvePool(pool).get_virtual_price();
}
```

**Key insight**: Read-only reentrancy doesn't attack the contract making the callback. It attacks **other contracts** that read the first contract's stale view functions.

## ERC-777 Callback Reentrancy

ERC-777 tokens call `tokensReceived()` on the recipient, creating a reentrancy vector on every transfer.

```solidity
// VULNERABLE: ERC-777 token triggers callback on transfer
function deposit(uint256 amount) external {
    shares[msg.sender] += calculateShares(amount);
    IERC777(token).send(address(this), amount, ""); // callback before state finalized
}

// SAFE: use ReentrancyGuard + CEI
function deposit(uint256 amount) external nonReentrant {
    uint256 shareAmount = calculateShares(amount);
    shares[msg.sender] += shareAmount;
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    emit Deposited(msg.sender, amount, shareAmount);
}
```

## ERC-1363 Callback Reentrancy

Similar to ERC-777 — `onTransferReceived()` is called on the recipient.

```solidity
// Any token implementing ERC-1363 transferAndCall will trigger onTransferReceived
// Always use ReentrancyGuard when accepting arbitrary tokens
```

## OpenZeppelin ReentrancyGuard

```solidity
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Vault is ReentrancyGuard {
    // Apply to ALL functions that:
    // 1. Make external calls
    // 2. Share state with functions that make external calls
    // 3. Are called by other protocols that might read your state

    function deposit(uint256 amount) external nonReentrant {
        // safe from reentrancy
    }

    function withdraw(uint256 amount) external nonReentrant {
        // safe from reentrancy
    }

    // View functions don't need nonReentrant unless read-only reentrancy is a concern
    // In that case, add a reentrancy check without the mutex reset:
    function getSharePrice() external view returns (uint256) {
        // Consider if stale reads during reentrancy could be exploited
    }
}
```

## Transient Storage Reentrancy Lock (EIP-1153)

Post-Cancun, use transient storage for cheaper reentrancy locks (~100 gas vs ~2,900 gas).

```solidity
contract TransientReentrancyGuard {
    bytes32 constant REENTRANCY_SLOT = keccak256("reentrancy.lock");

    modifier nonReentrant() {
        assembly {
            if tload(REENTRANCY_SLOT) { revert(0, 0) }
            tstore(REENTRANCY_SLOT, 1)
        }
        _;
        assembly {
            tstore(REENTRANCY_SLOT, 0)
        }
    }
}
```

## Reentrancy Checklist

- [ ] All functions with external calls have `nonReentrant`
- [ ] CEI ordering followed even with ReentrancyGuard (defense in depth)
- [ ] Cross-function reentrancy: all functions sharing state are guarded
- [ ] Cross-contract reentrancy: protocol-wide lock if contracts share state
- [ ] Read-only reentrancy: view functions considered for stale state exposure
- [ ] ERC-777/ERC-1363 tokens: callbacks accounted for in deposit/transfer flows
- [ ] Transient storage lock considered for post-Cancun deployments
