---
name: upgrade-safety
description: Upgrade vulnerability detection and prevention for Solidity proxy contracts. Use when implementing UUPS, Transparent, or Diamond proxy patterns. Covers uninitialized proxy attacks, storage collisions, selector clashing, and upgrade safety validation tools.
---

# Upgrade Safety

## Uninitialized Proxy

The most common upgrade vulnerability. If `initialize()` isn't called on the proxy immediately after deployment, an attacker can front-run and take ownership.

```solidity
// VULNERABLE: deployment and initialization are separate transactions
// Deploy proxy → attacker calls initialize() before admin
proxy = new ERC1967Proxy(implementation, "");
// ...gap where attacker calls initialize()...
VaultV1(proxy).initialize(admin);

// SAFE: initialize in the deployment transaction
bytes memory initData = abi.encodeCall(VaultV1.initialize, (admin));
proxy = new ERC1967Proxy(implementation, initData);
```

### Disable Initializers on Implementation

```solidity
contract VaultV1 is Initializable, OwnableUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __Ownable_init(admin);
    }
}
```

## Storage Collision

Upgrading with a mismatched storage layout corrupts state.

```solidity
// V1 Layout
contract VaultV1 {
    address public owner;       // slot 0
    uint256 public totalSupply; // slot 1
    uint256[48] private __gap;
}

// V2 BAD: inserted variable
contract VaultV2Bad {
    address public owner;       // slot 0
    address public treasury;    // slot 1 ← WAS totalSupply!
    uint256 public totalSupply; // slot 2 ← shifted, reads __gap[0]
    uint256[47] private __gap;
}

// V2 GOOD: appended variable
contract VaultV2Good {
    address public owner;       // slot 0
    uint256 public totalSupply; // slot 1
    address public treasury;    // slot 2 ← new, was __gap[0]
    uint256[47] private __gap;  // reduced from 48 to 47
}
```

### Verify with Forge

```bash
# Compare storage layouts between versions
forge inspect src/VaultV1.sol:VaultV1 storage-layout --pretty > layout-v1.txt
forge inspect src/VaultV2.sol:VaultV2 storage-layout --pretty > layout-v2.txt
diff layout-v1.txt layout-v2.txt
```

## Selfdestruct in Implementation

Pre-Dencun, if the implementation contract contained `selfdestruct` and an attacker could trigger it, all proxies pointing to that implementation would be bricked.

```solidity
// DANGEROUS: never include selfdestruct in implementations
contract BadImpl {
    function destroy() external onlyOwner {
        selfdestruct(payable(owner)); // bricks all proxies
    }
}

// Post-Dencun (EIP-6780): selfdestruct only sends ETH unless in the
// same transaction as creation. Still, never use it in implementations.
```

## Initializer Reentrancy

OpenZeppelin's `initializer` modifier includes reentrancy protection since v4.x. But custom initializers might not.

```solidity
// VULNERABLE: custom initializer without reentrancy protection
bool private _initialized;

function initialize(address admin) external {
    require(!_initialized);
    // External call before setting _initialized
    ICallback(admin).onInitialize(); // can re-enter initialize()
    _initialized = true;
}

// SAFE: use OpenZeppelin's Initializable
function initialize(address admin) external initializer {
    // modifier prevents reentrancy
}
```

## Missing Storage Gaps

Base contracts without `__gap` cannot be extended in future versions without breaking derived contracts.

```solidity
// BAD: no gap in base contract
abstract contract BaseV1 {
    uint256 public value;
    // no __gap — adding variables here shifts derived contract storage
}

contract DerivedV1 is BaseV1 {
    uint256 public derivedValue; // slot 1
}

// GOOD: gap in base contract
abstract contract BaseV1 {
    uint256 public value;
    uint256[49] private __gap;
}

// Now BaseV2 can safely add variables:
abstract contract BaseV2 {
    uint256 public value;
    uint256 public newValue; // uses first __gap slot
    uint256[48] private __gap;
}
```

## Function Selector Clashing

Proxy admin functions and implementation functions can have the same selector.

```solidity
// TransparentUpgradeableProxy solves this by routing:
// - Admin calls → proxy logic (upgrade, admin functions)
// - Non-admin calls → delegated to implementation

// UUPS: implementation must include upgradeTo function
// Risk: implementation function selector collides with ERC-1967 functions

// Check selectors:
// upgradeTo(address) → 0x3659cfe6
// Ensure no implementation function has selector 0x3659cfe6
```

```bash
# Detect selector collisions
forge inspect src/Vault.sol:Vault methodIdentifiers | sort
forge inspect src/Proxy.sol:Proxy methodIdentifiers | sort
# Compare for duplicates
```

## UUPS Upgrade Authorization

UUPS proxies delegate upgrade authorization to the implementation. If a new implementation forgets `_authorizeUpgrade`, the proxy becomes un-upgradeable.

```solidity
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract VaultV1 is UUPSUpgradeable, OwnableUpgradeable {
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {
        // Can add additional validation here
        // e.g., check newImplementation supports expected interface
    }
}

// V2 MUST also include _authorizeUpgrade
// If omitted, proxy is permanently locked to V2
contract VaultV2 is UUPSUpgradeable, OwnableUpgradeable {
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {}
}
```

## OpenZeppelin Upgrades Plugin

```bash
# Foundry: use forge-upgrades
forge install OpenZeppelin/openzeppelin-foundry-upgrades

# In tests: validate upgrade safety
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

function testUpgradeSafety() public {
    Upgrades.validateUpgrade("VaultV2.sol:VaultV2", referenceContract);
}
```

## Upgrade Safety Checklist

- [ ] `_disableInitializers()` in implementation constructor
- [ ] Proxy deployment includes initialization data (single transaction)
- [ ] Storage layout diffed between versions (`forge inspect`)
- [ ] New variables only appended, never inserted
- [ ] `__gap` reduced by correct amount
- [ ] Inheritance order unchanged between versions
- [ ] No `selfdestruct` in implementation
- [ ] UUPS: `_authorizeUpgrade` present in ALL versions
- [ ] Selector collision check between proxy and implementation
- [ ] `reinitializer(n)` used for V2+ initialization (not `initializer`)
- [ ] Upgrade tested on mainnet fork before deployment
- [ ] Timelock on upgrade function (production)
- [ ] OpenZeppelin Upgrades plugin validation passes
