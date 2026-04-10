---
name: storage-layout
description: EVM storage layout expertise for struct packing, proxy storage patterns, and collision avoidance. Use when designing data structures, working with upgradeable proxies, optimizing storage costs, or debugging storage-related issues.
---

# Storage Layout

## EVM Storage Fundamentals

Each storage slot is 32 bytes (256 bits). State variables are assigned slots sequentially starting at slot 0. Multiple variables smaller than 32 bytes are packed into a single slot when possible.

```solidity
// Slot 0: addr (20 bytes) + isActive (1 byte) + role (1 byte) = 22 bytes — fits one slot
// Slot 1: balance (32 bytes) — full slot
// Slot 2: lastUpdate (8 bytes) — new slot (won't pack with previous full slot)
contract Packed {
    address addr;       // 20 bytes  | slot 0
    bool isActive;      // 1 byte    | slot 0
    uint8 role;         // 1 byte    | slot 0
    uint256 balance;    // 32 bytes  | slot 1
    uint64 lastUpdate;  // 8 bytes   | slot 2
}
```

## Struct Packing

Order fields from largest to smallest alignment, grouping sub-32-byte fields together.

```solidity
// BAD: 4 slots (128 bytes)
struct UserBad {
    bool isActive;      // 1 byte   | slot 0 (31 bytes wasted)
    uint256 balance;    // 32 bytes | slot 1
    address wallet;     // 20 bytes | slot 2 (12 bytes wasted)
    uint256 rewards;    // 32 bytes | slot 3
}

// GOOD: 3 slots (96 bytes)
struct UserGood {
    uint256 balance;    // 32 bytes | slot 0
    uint256 rewards;    // 32 bytes | slot 1
    address wallet;     // 20 bytes | slot 2
    bool isActive;      // 1 byte   | slot 2 (packed with wallet)
}
```

### Aggressive Packing Example

```solidity
// 1 slot (32 bytes) for a position record
struct Position {
    address owner;      // 20 bytes
    uint48 openedAt;    // 6 bytes  (good until year 8.9M)
    uint40 collateral;  // 5 bytes  (up to ~1.1T with scaling)
    bool isLong;        // 1 byte
}
// Total: 20 + 6 + 5 + 1 = 32 bytes = 1 slot
```

### Timestamp Sizing Guide

| Type | Bytes | Max Value | Overflow Date |
|------|-------|-----------|---------------|
| uint32 | 4 | 4.29B | Feb 2106 |
| uint40 | 5 | 1.1T | Year ~36812 |
| uint48 | 6 | 281T | Year ~8.9M |

Use `uint48` for timestamps in most protocol designs. `uint32` overflows in 2106.

## Storage Slot Calculation

```solidity
// Fixed-size variables: sequential slots starting at 0
// Mappings: keccak256(key . slot)
// Dynamic arrays: length at slot, elements at keccak256(slot) + index
// Nested mappings: keccak256(innerKey . keccak256(outerKey . slot))

// Example: mapping(address => mapping(uint256 => uint256)) at slot 5
// Value at [addr][id] is stored at:
// keccak256(abi.encode(id, keccak256(abi.encode(addr, 5))))
```

## Inspecting Storage Layout

```bash
# Forge: inspect storage layout
forge inspect src/MyContract.sol:MyContract storage-layout --pretty

# Output shows slot, offset, type, and variable name
# Use this to verify packing and detect collisions before deployment
```

## Proxy Storage Patterns

### EIP-1967 Standard Slots

```solidity
// Implementation slot
bytes32 internal constant _IMPLEMENTATION_SLOT =
    0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    // bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)

// Admin slot
bytes32 internal constant _ADMIN_SLOT =
    0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    // bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)

// Beacon slot
bytes32 internal constant _BEACON_SLOT =
    0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;
    // bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
```

### Storage Gaps for Upgradeable Contracts

```solidity
abstract contract StorageGapExample {
    uint256 public value1;
    address public admin;

    // Reserve 48 slots for future storage variables
    // When adding new variables, reduce the gap size accordingly
    uint256[48] private __gap;
}

// In V2, adding a new variable:
abstract contract StorageGapExampleV2 {
    uint256 public value1;
    address public admin;
    uint256 public newValue;  // added in V2

    uint256[47] private __gap;  // reduced from 48 to 47
}
```

### Unstructured Storage (Diamond/EIP-2535)

```solidity
library LibDiamond {
    bytes32 constant DIAMOND_STORAGE_POSITION =
        keccak256("diamond.standard.diamond.storage");

    struct DiamondStorage {
        mapping(bytes4 => address) selectorToFacet;
        mapping(bytes4 => uint96) selectorToSlotPosition;
        bytes4[] selectors;
        mapping(bytes4 => bool) supportedInterfaces;
        address contractOwner;
    }

    function diamondStorage() internal pure returns (DiamondStorage storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }
}
```

## Namespace Storage Pattern (ERC-7201)

```solidity
/// @custom:storage-location erc7201:myprotocol.storage.vault
struct VaultStorage {
    mapping(address => uint256) balances;
    uint256 totalDeposited;
    bool paused;
}

// keccak256(abi.encode(uint256(keccak256("myprotocol.storage.vault")) - 1))
//   & ~bytes32(uint256(0xff))
bytes32 private constant VAULT_STORAGE_LOCATION =
    0x...;

function _getVaultStorage() private pure returns (VaultStorage storage $) {
    assembly {
        $.slot := VAULT_STORAGE_LOCATION
    }
}
```

## Common Mistakes

- **Reordering variables** in an upgradeable contract (shifts all subsequent slots)
- **Forgetting to reduce `__gap`** when adding variables
- **Changing variable types** (e.g., `uint128` to `uint256` shifts layout)
- **Inheriting in different order** between proxy versions
- **Not running `forge inspect`** before deploying upgrades

## Storage Layout Verification Checklist

- [ ] Run `forge inspect --storage-layout` on both old and new versions
- [ ] Diff the layouts to verify no slot collisions
- [ ] New variables only appended (never inserted)
- [ ] `__gap` reduced by exactly the number of new slots used
- [ ] Inheritance order unchanged between versions
- [ ] Use EIP-7201 namespaced storage for new diamond/modular patterns
- [ ] Struct field order optimized for packing
