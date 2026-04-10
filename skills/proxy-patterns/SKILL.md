---
name: proxy-patterns
description: Use when choosing or implementing proxy/upgrade patterns. Compares UUPS (EIP-1822), TransparentUpgradeableProxy, Beacon proxy, minimal proxy (EIP-1167), and Diamond (EIP-2535) with gas costs, flexibility, and security tradeoffs.
---

# Proxy Patterns Overview

## How Proxies Work

A proxy contract delegates all calls to an implementation contract via `delegatecall`. Storage lives in the proxy, logic lives in the implementation. Upgrading means pointing the proxy at a new implementation.

```
User → Proxy (storage) --delegatecall--> Implementation (logic)
```

## Pattern Comparison

| Pattern | Gas (deploy) | Gas (call) | Upgrade mechanism | Best for |
|---------|-------------|-----------|-------------------|----------|
| UUPS | Low | Low (~200 overhead) | Implementation upgrades itself | Most contracts |
| Transparent | Medium | Medium (~2100 overhead) | Admin-only proxy upgrade | Governed protocols |
| Beacon | Medium | Medium (~2600 overhead) | Beacon stores impl address | Many identical proxies |
| Minimal (1167) | Very low | Low (~700 overhead) | Not upgradeable | Factory clones |
| Diamond (2535) | High | Medium | Per-function routing | Large systems |

## UUPS Proxy (EIP-1822) — Recommended Default

The upgrade logic lives in the implementation contract. Smaller proxy, cheaper deployment.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract MyContractV1 is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    uint256 public value;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
    }

    function setValue(uint256 v) external { value = v; }

    function _authorizeUpgrade(address newImpl) internal override onlyOwner {}
}
```

Deploy with:
```solidity
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

address impl = address(new MyContractV1());
bytes memory data = abi.encodeCall(MyContractV1.initialize, (msg.sender));
address proxy = address(new ERC1967Proxy(impl, data));
```

## Transparent Upgradeable Proxy

Upgrade logic is in the proxy itself. Admin address is blocked from calling implementation functions (prevents selector clashing).

```solidity
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

ProxyAdmin admin = new ProxyAdmin(msg.sender);
TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
    address(impl), address(admin), initData
);

// Upgrade:
admin.upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), newImpl, "");
```

## Storage Layout Rules (Critical)

Upgradeable contracts MUST follow strict storage rules:

1. **Never remove or reorder storage variables** — only append
2. **Use storage gaps for inheritance chains**:
```solidity
contract BaseV1 is Initializable {
    uint256 public x;
    uint256[49] private __gap; // reserve 49 slots

    // V2 can use a gap slot:
    // uint256 public y;
    // uint256[48] private __gap;
}
```
3. **No constructors** — use `initialize` + `Initializable`
4. **No immutable variables that depend on constructor** (immutables are in bytecode, not storage)

## Decision Tree

```
Need upgradeability?
├── No → Minimal Proxy (EIP-1167) for clones, or deploy directly
└── Yes
    ├── Many identical proxies? → Beacon Proxy
    ├── Large contract (>24kb)? → Diamond (EIP-2535)
    ├── Governance / multisig admin? → Transparent Proxy
    └── Default → UUPS Proxy
```

## Upgrade Safety Checklist

- [ ] Storage layout is append-only (no reorder, no removal)
- [ ] Use `__gap` arrays in base contracts (reserve 50 slots)
- [ ] Constructor calls `_disableInitializers()`
- [ ] `initialize` uses `initializer` modifier
- [ ] `_authorizeUpgrade` has proper access control (UUPS)
- [ ] New implementation is tested against existing storage
- [ ] Run `forge inspect --storage-layout` to compare layouts
- [ ] Test upgrade path: deploy v1 → upgrade to v2 → verify state
- [ ] ERC-1967 storage slots used for impl/admin/beacon addresses
- [ ] No `selfdestruct` in implementation (would kill proxy)

## ERC-1967 Storage Slots

Standard slots prevent storage collisions:

```solidity
// Implementation: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

// Admin: bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)
bytes32 constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

// Beacon: bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
bytes32 constant BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;
```

## Testing Upgrades with Foundry

```solidity
function test_upgrade() public {
    // Deploy V1
    MyContractV1 implV1 = new MyContractV1();
    ERC1967Proxy proxy = new ERC1967Proxy(
        address(implV1), abi.encodeCall(MyContractV1.initialize, (address(this)))
    );
    MyContractV1(address(proxy)).setValue(42);

    // Deploy V2 and upgrade
    MyContractV2 implV2 = new MyContractV2();
    MyContractV1(address(proxy)).upgradeToAndCall(address(implV2), "");

    // State is preserved
    assertEq(MyContractV2(address(proxy)).value(), 42);
    // New V2 functionality works
    MyContractV2(address(proxy)).newFunction();
}
```
