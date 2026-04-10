---
name: error-handling
description: Custom error patterns and revert handling for Solidity. Use when designing error hierarchies, implementing try/catch for external calls, or establishing error conventions across a protocol. Covers custom errors, revert patterns, error propagation, and NatSpec documentation.
---

# Error Handling

## Custom Errors vs Require Strings

Custom errors are cheaper and more expressive. Always prefer them.

```solidity
// BAD: require with string (~200 gas more per revert, larger bytecode)
require(amount > 0, "Amount must be greater than zero");
require(msg.sender == owner, "Not authorized");

// GOOD: custom errors
error ZeroAmount();
error Unauthorized(address caller, address required);

if (amount == 0) revert ZeroAmount();
if (msg.sender != owner) revert Unauthorized(msg.sender, owner);
```

### Gas Comparison

| Pattern | Deploy Cost | Revert Cost |
|---------|------------|-------------|
| `require("string")` | +~200 bytes | ~2,400 gas |
| `revert CustomError()` | +~4 bytes | ~2,200 gas |
| `revert CustomError(param)` | +~4 bytes | ~2,300 gas |

## Error Hierarchy Design

Organize errors by domain for large protocols. Prefix with the contract or module name for clarity in offchain decoding.

```solidity
// errors/VaultErrors.sol
interface VaultErrors {
    error Vault_InsufficientBalance(address user, uint256 available, uint256 requested);
    error Vault_DepositCapExceeded(uint256 cap, uint256 attempted);
    error Vault_WithdrawalPaused();
    error Vault_InvalidToken(address token);
    error Vault_SlippageExceeded(uint256 expected, uint256 actual);
}

// errors/OracleErrors.sol
interface OracleErrors {
    error Oracle_StalePrice(address feed, uint256 updatedAt, uint256 threshold);
    error Oracle_InvalidRound(uint80 roundId);
    error Oracle_NegativePrice(int256 price);
    error Oracle_ZeroPrice();
}

// Inherit in implementation
contract Vault is VaultErrors, OracleErrors {
    function withdraw(uint256 amount) external {
        uint256 balance = balances[msg.sender];
        if (balance < amount) {
            revert Vault_InsufficientBalance(msg.sender, balance, amount);
        }
        // ...
    }
}
```

## Try/Catch for External Calls

Use `try/catch` when you need to handle failures from external contract calls gracefully.

```solidity
interface IPriceFeed {
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt,
        uint256 updatedAt, uint80 answeredInRound
    );
}

function getPrice(IPriceFeed feed) internal view returns (uint256) {
    try feed.latestRoundData() returns (
        uint80, int256 answer, uint256, uint256 updatedAt, uint80
    ) {
        if (answer <= 0) revert Oracle_NegativePrice(answer);
        if (block.timestamp - updatedAt > STALENESS_THRESHOLD) {
            revert Oracle_StalePrice(address(feed), updatedAt, STALENESS_THRESHOLD);
        }
        return uint256(answer);
    } catch Error(string memory reason) {
        // Catches require() / revert("string") failures
        revert OracleCallFailed(reason);
    } catch (bytes memory lowLevelData) {
        // Catches custom errors, panics, or out-of-gas
        revert OracleCallFailedBytes(lowLevelData);
    }
}
```

### Try/Catch Limitations

- Only works on **external** function calls and contract creation
- Cannot catch out-of-gas in the calling context (only in the callee)
- `catch Panic(uint256 code)` catches arithmetic overflow, division by zero, etc.

```solidity
try target.someFunction() returns (uint256 result) {
    return result;
} catch Panic(uint256 code) {
    // code 0x01: assert failure
    // code 0x11: arithmetic overflow
    // code 0x12: division by zero
    // code 0x32: array out of bounds
    emit PanicCaught(code);
    return 0;
} catch Error(string memory reason) {
    emit ErrorCaught(reason);
    return 0;
} catch (bytes memory) {
    // Low-level or custom error
    return 0;
}
```

## Error Propagation

Bubble up errors from low-level calls preserving the original revert reason.

```solidity
function execute(address target, bytes calldata data) external returns (bytes memory) {
    (bool success, bytes memory returndata) = target.call(data);

    if (!success) {
        // If there's revert data, bubble it up
        if (returndata.length > 0) {
            assembly {
                revert(add(returndata, 32), mload(returndata))
            }
        }
        revert ExecutionFailed(target);
    }

    return returndata;
}
```

## Decoding Custom Errors Offchain

```typescript
import { ethers } from "ethers";

const iface = new ethers.Interface([
  "error Vault_InsufficientBalance(address user, uint256 available, uint256 requested)",
]);

try {
  await vault.withdraw(amount);
} catch (err: any) {
  const decoded = iface.parseError(err.data);
  if (decoded?.name === "Vault_InsufficientBalance") {
    const [user, available, requested] = decoded.args;
    console.log(`${user} has ${available}, needs ${requested}`);
  }
}
```

## NatSpec for Errors

Document every custom error with `@dev` explaining when it triggers.

```solidity
/// @dev Thrown when a user attempts to withdraw more than their balance.
/// @param user The address attempting the withdrawal.
/// @param available The user's current balance.
/// @param requested The amount requested.
error Vault_InsufficientBalance(address user, uint256 available, uint256 requested);

/// @dev Thrown when the oracle price feed returns stale data.
/// @param feed The address of the price feed.
/// @param updatedAt The timestamp of the last update.
/// @param threshold The maximum allowed staleness in seconds.
error Oracle_StalePrice(address feed, uint256 updatedAt, uint256 threshold);
```

## Error Design Guidelines

1. **Encode useful context** — include parameters that help diagnose the issue
2. **Use prefixed names** — `Module_ErrorName` prevents selector collisions across large codebases
3. **Keep parameter count reasonable** — 1-3 parameters; more wastes gas on revert
4. **Don't use errors for control flow** — revert is not a return mechanism
5. **Group errors in interfaces** — collect related errors for reuse across contracts
6. **Document trigger conditions** — every error needs a `@dev` tag explaining when/why

## Error Handling Checklist

- [ ] All `require()` converted to custom errors
- [ ] Errors organized by domain in separate interfaces
- [ ] Error names prefixed with module name
- [ ] NatSpec `@dev` on every custom error
- [ ] External calls wrapped in try/catch where graceful degradation is needed
- [ ] Low-level calls bubble up revert reasons
- [ ] Offchain tooling can decode all custom errors (ABI includes error definitions)
