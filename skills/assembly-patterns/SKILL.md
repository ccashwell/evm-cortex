---
name: assembly-patterns
description: Yul/inline assembly patterns for advanced Solidity optimization. Use only when gas savings are significant and measured. Covers memory management, efficient hashing, bitwise operations, custom errors, low-level calls, and returndata handling.
---

# Assembly Patterns

## When to Use Assembly

Only use assembly when:
1. Gas savings are **measured** (not assumed) via `forge test --gas-report`
2. The optimization is in a **hot path** (called frequently)
3. Solidity cannot express the operation (e.g., specific memory layout)
4. Savings exceed 500 gas per call for the added complexity

Always add `@dev` NatSpec explaining why assembly is used and what it does.

## Memory Management

EVM memory layout:
- `0x00-0x3f` (64 bytes): Scratch space for hashing
- `0x40-0x5f` (32 bytes): Free memory pointer
- `0x60-0x7f` (32 bytes): Zero slot

```solidity
/// @dev Efficiently computes keccak256(abi.encodePacked(a, b)) using scratch space.
function efficientHash(bytes32 a, bytes32 b) internal pure returns (bytes32 result) {
    assembly {
        mstore(0x00, a)
        mstore(0x20, b)
        result := keccak256(0x00, 0x40)
    }
}
```

## Efficient Hashing

Hashing pairs for Merkle trees — avoids memory allocation overhead.

```solidity
/// @dev Hashes a leaf pair for Merkle tree construction. Sorts to ensure
///      consistent ordering regardless of input order.
function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32 result) {
    assembly {
        // Sort to produce canonical ordering
        switch lt(a, b)
        case 1 {
            mstore(0x00, a)
            mstore(0x20, b)
        }
        default {
            mstore(0x00, b)
            mstore(0x20, a)
        }
        result := keccak256(0x00, 0x40)
    }
}
```

## Bitwise Packing and Unpacking

Pack multiple values into a single uint256 for storage efficiency.

```solidity
/// @dev Packs owner (160 bits), amount (80 bits), timestamp (16 bits) into uint256.
function pack(address owner, uint80 amount, uint16 ts) internal pure returns (uint256 packed) {
    assembly {
        packed := or(or(shl(96, owner), shl(16, amount)), ts)
    }
}

function unpackOwner(uint256 packed) internal pure returns (address owner) {
    assembly {
        owner := shr(96, packed)
    }
}

function unpackAmount(uint256 packed) internal pure returns (uint80 amount) {
    assembly {
        amount := and(shr(16, packed), 0xffffffffffffffffffff) // 80-bit mask
    }
}

function unpackTimestamp(uint256 packed) internal pure returns (uint16 ts) {
    assembly {
        ts := and(packed, 0xffff)
    }
}
```

## Custom Errors in Assembly

Revert with custom error selectors without Solidity overhead.

```solidity
error Unauthorized();           // selector: 0x82b42900
error InsufficientBalance(uint256 available, uint256 required);

/// @dev Reverts with Unauthorized() using minimal gas.
function _revertUnauthorized() internal pure {
    assembly {
        mstore(0x00, 0x82b42900) // Unauthorized() selector
        revert(0x1c, 0x04)       // offset to align 4-byte selector
    }
}

/// @dev Reverts with InsufficientBalance(available, required).
function _revertInsufficientBalance(uint256 available, uint256 required) internal pure {
    assembly {
        let ptr := mload(0x40)
        mstore(ptr, 0xf4d678b8)           // InsufficientBalance selector
        mstore(add(ptr, 0x04), available)
        mstore(add(ptr, 0x24), required)
        revert(add(ptr, 0x1c), 0x44)      // 4 + 32 + 32 = 68 bytes
    }
}
```

## Low-Level Calls

```solidity
/// @dev Performs a low-level call and bubbles up revert data on failure.
function _call(address target, bytes memory data) internal returns (bytes memory) {
    (bool success, bytes memory returndata) = target.call(data);

    if (!success) {
        assembly {
            // Bubble up the revert reason
            revert(add(returndata, 0x20), mload(returndata))
        }
    }

    return returndata;
}
```

## Return Data Handling

```solidity
/// @dev Checks if a call returned true (for ERC-20 compatibility).
///      Handles tokens that return nothing (USDT), false, or true.
function _callOptionalReturn(address token, bytes memory data) internal {
    (bool success, bytes memory returndata) = token.call(data);

    if (!success) {
        assembly {
            revert(add(returndata, 0x20), mload(returndata))
        }
    }

    // If returndata is present, it must decode to true
    if (returndata.length > 0) {
        if (abi.decode(returndata, (bool)) == false) {
            revert TokenCallFailed();
        }
    }
}
```

## Efficient Address Checks

```solidity
/// @dev Checks if an address is a contract (has code). Uses extcodesize.
function isContract(address account) internal view returns (bool result) {
    assembly {
        result := gt(extcodesize(account), 0)
    }
}

/// @dev Reverts if addr is the zero address.
function _requireNonZero(address addr) internal pure {
    assembly {
        if iszero(addr) {
            mstore(0x00, 0xd92e233d) // ZeroAddress() selector
            revert(0x1c, 0x04)
        }
    }
}
```

## Efficient Event Emission

```solidity
/// @dev Emits Transfer(from, to, amount) without Solidity ABI encoding overhead.
function _emitTransfer(address from, address to, uint256 amount) internal {
    assembly {
        // Transfer(address,address,uint256) topic
        let sig := 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
        mstore(0x00, amount)
        log3(0x00, 0x20, sig, from, to)
    }
}
```

## Safety Rules

1. **Never use assembly for simple operations** that Solidity handles well
2. **Always validate inputs** before assembly blocks — assembly skips Solidity's type safety
3. **Document every assembly block** with NatSpec explaining the operation
4. **Test extensively** — assembly bugs are silent and devastating
5. **Use `returndatasize()` instead of hardcoded sizes** when reading return data
6. **Avoid `mstore` past the free memory pointer** without updating it
7. **Never use `selfdestruct`** in assembly (deprecated, behavior changes post-Dencun)

## Assembly Checklist

- [ ] Gas savings measured with `forge test --gas-report` (before/after)
- [ ] Savings exceed 500 gas in a hot path
- [ ] NatSpec `@dev` comment explains why assembly is used
- [ ] All memory operations respect the free memory pointer
- [ ] No writes to reserved memory areas (0x00-0x3f) that persist beyond scratch use
- [ ] Return data handling uses `returndatasize()` not hardcoded lengths
- [ ] Edge cases tested: zero values, max values, empty calldata
