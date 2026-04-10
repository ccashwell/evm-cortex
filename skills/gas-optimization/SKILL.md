---
name: gas-optimization
description: Gas optimization patterns for Solidity smart contracts. Use when optimizing contract deployment cost, runtime gas usage, or reviewing gas-critical paths. Covers calldata vs memory, immutable/constant, unchecked blocks, storage packing, batch operations, and custom errors.
---

# Gas Optimization

## Measure First

Never optimize blindly. Use forge snapshots and gas reports.

```bash
# Gas report for all tests
forge test --gas-report

# Snapshot to compare before/after
forge snapshot
# ...make changes...
forge snapshot --diff
```

## Custom Errors Over Require Strings

Custom errors save ~50 gas on deployment and ~200 gas per revert vs `require("string")`.

```solidity
// BAD: ~24,000 gas on revert (stores string in bytecode + memory)
require(amount > 0, "Amount must be greater than zero");

// GOOD: ~24 gas for error selector encoding
error ZeroAmount();
if (amount == 0) revert ZeroAmount();
```

## Calldata vs Memory

Use `calldata` for read-only external function parameters. Avoids copying to memory.

```solidity
// BAD: copies entire array to memory (~3 gas per byte + allocation)
function processOrders(Order[] memory orders) external { ... }

// GOOD: reads directly from calldata
function processOrders(Order[] calldata orders) external { ... }

// Gas savings scale with input size:
// 100 bytes: ~600 gas saved
// 1KB:       ~6,000 gas saved
// 10KB:      ~60,000 gas saved
```

## Immutable and Constant

```solidity
// constant: compile-time value, inlined everywhere. 0 gas for SLOAD.
uint256 public constant MAX_SUPPLY = 10_000;
bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name)");

// immutable: set once in constructor, stored in bytecode. 0 gas for SLOAD.
address public immutable FACTORY;
uint256 public immutable DEPLOYMENT_TIMESTAMP;

constructor(address factory) {
    FACTORY = factory;
    DEPLOYMENT_TIMESTAMP = block.timestamp;
}

// Regular storage variable: 2,100 gas (cold) or 100 gas (warm) per SLOAD
address public admin; // avoid if value never changes after deployment
```

## Unchecked Arithmetic

When overflow is impossible (e.g., loop counters bounded by array length), use `unchecked` to skip overflow checks (~40 gas per operation).

```solidity
// BAD: overflow checks on every increment
for (uint256 i = 0; i < arr.length; i++) { ... }

// GOOD: i cannot overflow (bounded by array length, which fits in uint256)
for (uint256 i; i < arr.length;) {
    // process arr[i]
    unchecked { ++i; }
}
```

## Cache Storage Reads

Every SLOAD costs 2,100 gas (cold) or 100 gas (warm). Cache values read more than once.

```solidity
// BAD: 3 SLOADs for totalSupply
function distribute() external {
    if (totalSupply == 0) revert NoSupply();           // SLOAD 1
    uint256 perToken = rewards / totalSupply;           // SLOAD 2
    emit Distributed(perToken, totalSupply);            // SLOAD 3
}

// GOOD: 1 SLOAD, cached in memory
function distribute() external {
    uint256 supply = totalSupply;                       // SLOAD 1 (cached)
    if (supply == 0) revert NoSupply();
    uint256 perToken = rewards / supply;
    emit Distributed(perToken, supply);
}
```

## Storage Packing

Pack related variables into single 32-byte slots. See `storage-layout` skill for details.

```solidity
// BAD: 3 slots
uint256 amount;     // slot 0
address user;       // slot 1
bool active;        // slot 2

// GOOD: 2 slots
uint256 amount;     // slot 0
address user;       // slot 1 (20 bytes)
bool active;        // slot 1 (packed, +1 byte)
```

Writing to packed slots together in one transaction saves ~20,000 gas (avoids separate SSTORE).

## Short-Circuit Evaluation

Put cheap checks first in `&&` / `||` chains.

```solidity
// BAD: expensive SLOAD first
if (balances[msg.sender] > minBalance && isWhitelisted) { ... }

// GOOD: cheap check first, SLOAD only if needed
if (isWhitelisted && balances[msg.sender] > minBalance) { ... }
```

## Batch Operations

Amortize fixed overhead (21,000 base gas, cold SLOADs) across multiple operations.

```solidity
function batchTransfer(
    IERC20 token,
    address[] calldata recipients,
    uint256[] calldata amounts
) external {
    uint256 len = recipients.length;
    if (len != amounts.length) revert ArrayLengthMismatch();

    for (uint256 i; i < len;) {
        token.safeTransfer(recipients[i], amounts[i]);
        unchecked { ++i; }
    }
}
```

## Avoid Redundant Zero Initialization

The EVM initializes all values to zero. Explicit zero assignment wastes gas.

```solidity
// BAD: redundant zero init
uint256 counter = 0;
bool flag = false;

// GOOD: default is already zero/false
uint256 counter;
bool flag;
```

## Use Bytes32 Over String for Short Constants

```solidity
// BAD: dynamic string requires more gas
string public constant NAME = "MyToken";

// GOOD: fixed-size, cheaper to read
bytes32 public constant NAME = "MyToken";
```

## Precompute Keccak256 Hashes

```solidity
// BAD: computed at runtime every call
function hasRole(string memory role) external view {
    bytes32 hash = keccak256(abi.encodePacked(role));
    ...
}

// GOOD: precomputed constant
bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
```

## Function Ordering by Selector

The Solidity dispatcher checks function selectors in order. Frequently called functions with lower selectors dispatch faster. Not worth manual optimization unless the contract has 50+ external functions.

## Gas Optimization Checklist

| Optimization | Typical Savings |
|-------------|----------------|
| Custom errors vs require strings | ~200 gas/revert |
| calldata vs memory | ~600+ gas/call |
| immutable vs storage | ~2,100 gas/read |
| Unchecked loop increment | ~40 gas/iteration |
| Cache storage reads | ~100-2,100 gas/read |
| Storage packing | ~20,000 gas/write |
| ++i vs i++ | ~5 gas/iteration |
| Zero-init removal | ~3 gas/variable |

## When NOT to Optimize

- Readability loss outweighs savings for admin-only / rare-path functions
- One-time setup functions (constructors, initializers)
- Gas savings under 100 gas in non-hot paths
- Assembly tricks without measured benchmarks
