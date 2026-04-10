---
name: minimal-proxy
description: Use when deploying many identical contracts cheaply with EIP-1167 minimal proxy (clones). Covers Clones library, initialization patterns, gas efficiency, factory patterns, and limitations.
---

# EIP-1167 Minimal Proxy (Clones)

## Overview

EIP-1167 defines a minimal bytecode proxy that delegates all calls to a known implementation. The clone is only 45 bytes of bytecode and costs ~36,000 gas to deploy (vs ~200,000+ for a full contract). Not upgradeable — the implementation address is baked into the bytecode.

## Clone Bytecode

```
363d3d373d3d3d363d73<implementation>5af43d82803e903d91602b57fd5bf3
```

This is a pure `delegatecall` forwarder. All storage lives in the clone, logic executes from the implementation.

## Factory Pattern with OpenZeppelin Clones

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract VaultFactory {
    using Clones for address;

    address public immutable implementation;
    address[] public allVaults;

    event VaultCreated(address indexed vault, address indexed owner, uint256 index);

    constructor(address implementation_) {
        implementation = implementation_;
    }

    function createVault(
        address owner,
        address asset,
        string calldata name
    ) external returns (address vault) {
        vault = implementation.clone();
        IVault(vault).initialize(owner, asset, name);
        allVaults.push(vault);
        emit VaultCreated(vault, owner, allVaults.length - 1);
    }

    function createVaultDeterministic(
        address owner,
        address asset,
        string calldata name,
        bytes32 salt
    ) external returns (address vault) {
        vault = implementation.cloneDeterministic(salt);
        IVault(vault).initialize(owner, asset, name);
        allVaults.push(vault);
        emit VaultCreated(vault, owner, allVaults.length - 1);
    }

    function predictAddress(bytes32 salt) external view returns (address) {
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
```

## Implementation Contract (Clone Target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVault {
    function initialize(address owner, address asset, string calldata name) external;
}

contract Vault is Initializable, IVault {
    using SafeERC20 for IERC20;

    address public owner;
    IERC20 public asset;
    string public name;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address owner_, address asset_, string calldata name_)
        external override initializer
    {
        owner = owner_;
        asset = IERC20(asset_);
        name = name_;
    }

    function deposit(uint256 amount) external {
        asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external onlyOwner {
        asset.safeTransfer(owner, amount);
    }
}
```

## Gas Comparison

| Operation | Full Deploy | Clone Deploy | Savings |
|-----------|------------|-------------|---------|
| Deploy cost | ~500,000 gas | ~46,000 gas | ~91% |
| Runtime overhead | 0 | ~700 gas/call | Negligible |
| Bytecode size | Full contract | 45 bytes | ~99% |

For protocols deploying many instances (vaults, escrows, pools), clones can save millions of gas.

## Deterministic Clones (CREATE2)

Predict clone addresses before deployment:

```solidity
bytes32 salt = keccak256(abi.encode(msg.sender, tokenAddress, block.timestamp));
address predicted = Clones.predictDeterministicAddress(implementation, salt, address(factory));

// Deploy later:
address deployed = Clones.cloneDeterministic(implementation, salt);
assert(deployed == predicted);
```

## Clones with Immutable Args (CWIA)

For clones that need constructor-like args baked into bytecode (not storage), use the CWIA pattern. Args are appended to the clone bytecode and read via `calldataload`:

```solidity
import {ClonesWithImmutableArgs} from "clones-with-immutable-args/ClonesWithImmutableArgs.sol";

contract Factory {
    using ClonesWithImmutableArgs for address;

    function createClone(address impl, address owner, uint256 threshold)
        external returns (address)
    {
        bytes memory data = abi.encodePacked(owner, threshold);
        return impl.clone(data);
    }
}

contract CloneImpl {
    function _getArgAddress(uint256 argOffset) internal pure returns (address) {
        return address(uint160(_getArgUint256(argOffset)));
    }

    function owner() public pure returns (address) {
        return _getArgAddress(0);
    }

    function threshold() public pure returns (uint256) {
        return _getArgUint256(20);
    }
}
```

## Limitations

- **Not upgradeable**: Implementation address is hardcoded in bytecode
- **Same bytecode**: All clones share the same logic, differ only in storage
- **No constructor**: Must use `initialize` pattern
- **Double-init risk**: Always use `Initializable` to prevent re-initialization
- **`address(this)` in implementation**: Returns the clone's address (correct behavior)
- **Cannot receive ETH without `receive()`**: Implementation must have `receive()` if clones need to accept ETH

## Testing

```solidity
function test_cloneFactory() public {
    Vault impl = new Vault();
    VaultFactory factory = new VaultFactory(address(impl));

    address vault1 = factory.createVault(alice, address(usdc), "Vault 1");
    address vault2 = factory.createVault(bob, address(weth), "Vault 2");

    // Different addresses, same logic
    assertTrue(vault1 != vault2);
    assertEq(Vault(vault1).owner(), alice);
    assertEq(Vault(vault2).owner(), bob);

    // Cannot re-initialize
    vm.expectRevert();
    Vault(vault1).initialize(bob, address(weth), "Hijack");
}

function test_deterministicClone() public {
    bytes32 salt = keccak256("test");
    address predicted = factory.predictAddress(salt);
    address deployed = factory.createVaultDeterministic(alice, address(usdc), "V1", salt);
    assertEq(predicted, deployed);
}
```

## When to Use Clones

- **Use when**: Deploying many instances of the same contract (pools, vaults, escrows, accounts)
- **Don't use when**: Contracts need upgradeability, or each instance has different logic
- **Consider CWIA when**: Clones need immutable configuration that doesn't change after deploy
