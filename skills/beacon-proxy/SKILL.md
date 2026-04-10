---
name: beacon-proxy
description: Use when deploying many identical upgradeable proxies using the Beacon proxy pattern. Covers UpgradeableBeacon, BeaconProxy, bulk upgrades, use cases, and comparison with UUPS/Transparent.
---

# Beacon Proxy Pattern

## Overview

The Beacon proxy pattern stores the implementation address in a shared Beacon contract. Multiple proxies point to the same Beacon. Upgrading the Beacon upgrades ALL proxies in a single transaction.

```
BeaconProxy-1 ──┐
BeaconProxy-2 ──┼──→ UpgradeableBeacon ──→ Implementation v1
BeaconProxy-3 ──┘

After upgrade:

BeaconProxy-1 ──┐
BeaconProxy-2 ──┼──→ UpgradeableBeacon ──→ Implementation v2
BeaconProxy-3 ──┘
```

## UpgradeableBeacon

```solidity
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

// Deploy beacon with initial implementation
address impl = address(new VaultV1());
UpgradeableBeacon beacon = new UpgradeableBeacon(impl, msg.sender);

// Upgrade all proxies at once
address newImpl = address(new VaultV2());
beacon.upgradeTo(newImpl);
```

## BeaconProxy Deployment

```solidity
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

// Each proxy points to the beacon (not the implementation directly)
bytes memory initData = abi.encodeCall(VaultV1.initialize, (owner, asset));
BeaconProxy proxy = new BeaconProxy(address(beacon), initData);
```

## Complete Factory Pattern

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VaultFactory is Ownable {
    UpgradeableBeacon public immutable beacon;
    address[] public allVaults;

    event VaultCreated(address indexed vault, address indexed owner, uint256 index);
    event ImplementationUpgraded(address indexed newImpl);

    constructor(address initialImpl) Ownable(msg.sender) {
        beacon = new UpgradeableBeacon(initialImpl, address(this));
    }

    function createVault(address vaultOwner, address asset)
        external returns (address vault)
    {
        bytes memory initData = abi.encodeCall(
            IVault.initialize, (vaultOwner, asset)
        );
        vault = address(new BeaconProxy(address(beacon), initData));
        allVaults.push(vault);
        emit VaultCreated(vault, vaultOwner, allVaults.length - 1);
    }

    function upgradeImplementation(address newImpl) external onlyOwner {
        beacon.upgradeTo(newImpl);
        emit ImplementationUpgraded(newImpl);
    }

    function implementation() external view returns (address) {
        return beacon.implementation();
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
```

## Implementation Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVault {
    function initialize(address owner, address asset) external;
}

contract VaultV1 is Initializable, IVault {
    using SafeERC20 for IERC20;

    address public owner;
    IERC20 public asset;
    uint256 public totalDeposited;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address owner_, address asset_) external override initializer {
        owner = owner_;
        asset = IERC20(asset_);
    }

    function deposit(uint256 amount) external {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "Not owner");
        totalDeposited -= amount;
        asset.safeTransfer(owner, amount);
    }
}

contract VaultV2 is Initializable, IVault {
    using SafeERC20 for IERC20;

    address public owner;
    IERC20 public asset;
    uint256 public totalDeposited;
    // V2: new storage variable (appended, never reorder)
    uint256 public depositCap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address owner_, address asset_) external override initializer {
        owner = owner_;
        asset = IERC20(asset_);
    }

    function setDepositCap(uint256 cap) external {
        require(msg.sender == owner, "Not owner");
        depositCap = cap;
    }

    function deposit(uint256 amount) external {
        require(depositCap == 0 || totalDeposited + amount <= depositCap, "Cap exceeded");
        asset.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "Not owner");
        totalDeposited -= amount;
        asset.safeTransfer(owner, amount);
    }
}
```

## Beacon vs UUPS vs Transparent

| Feature | Beacon | UUPS | Transparent |
|---------|--------|------|-------------|
| Upgrade scope | All proxies at once | One proxy at a time | One proxy at a time |
| Who upgrades | Beacon owner | Implementation | Proxy admin |
| Gas per call | +2600 (SLOAD beacon) | +200 | +2100 (admin check) |
| Deploy cost/proxy | ~47k | ~65k | ~120k |
| Best for | Many identical instances | General purpose | Governed contracts |

## When to Use Beacon

- Deploying many proxies with the same implementation (vaults, accounts, pools)
- Need to upgrade all instances simultaneously
- Factory pattern where users deploy their own instance
- Protocol wants single upgrade transaction (simpler governance)

## Gas Considerations

Each call to a BeaconProxy costs an extra `SLOAD` (~2100 gas cold, ~100 warm) to read the implementation address from the Beacon. For high-frequency calls, consider caching patterns or UUPS instead.

## Deterministic Beacon Proxies

```solidity
function createVaultDeterministic(
    address vaultOwner,
    address asset,
    bytes32 salt
) external returns (address vault) {
    bytes memory initData = abi.encodeCall(IVault.initialize, (vaultOwner, asset));
    vault = address(new BeaconProxy{salt: salt}(address(beacon), initData));
    allVaults.push(vault);
}
```

## Testing

```solidity
function test_beaconUpgrade() public {
    VaultV1 implV1 = new VaultV1();
    VaultFactory factory = new VaultFactory(address(implV1));

    address vault = factory.createVault(alice, address(usdc));
    assertEq(factory.implementation(), address(implV1));

    // Deposit with V1
    vm.startPrank(alice);
    usdc.approve(vault, 100e6);
    VaultV1(vault).deposit(100e6);
    assertEq(VaultV1(vault).totalDeposited(), 100e6);
    vm.stopPrank();

    // Upgrade to V2
    VaultV2 implV2 = new VaultV2();
    factory.upgradeImplementation(address(implV2));

    // State preserved, new function available
    assertEq(VaultV2(vault).totalDeposited(), 100e6);
    vm.prank(alice);
    VaultV2(vault).setDepositCap(1000e6);
    assertEq(VaultV2(vault).depositCap(), 1000e6);
}
```

## Security Checklist

- [ ] Beacon owner is a multisig or governance contract
- [ ] Implementation follows storage layout rules (append-only)
- [ ] `_disableInitializers()` in implementation constructor
- [ ] Test upgrade path preserves all existing state
- [ ] New implementation is deployed and verified before upgrade
- [ ] Beacon address is immutable in factory (cannot be swapped)
