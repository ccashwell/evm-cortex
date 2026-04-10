---
name: constructor-patterns
description: Constructor and initializer patterns for deploying Solidity contracts. Use when designing deployment flows, upgradeable proxies, factory patterns, or CREATE2 deployments. Covers constructor validation, initializer safety, and factory patterns.
---

# Constructor & Initializer Patterns

## Constructor for Non-Upgradeable Contracts

Constructors run once at deployment. Validate all parameters and set immutables.

```solidity
contract Vault {
    error ZeroAddress();
    error InvalidFee(uint256 fee);

    address public immutable TOKEN;
    address public immutable ORACLE;
    uint256 public immutable FEE_BPS;
    uint256 public immutable DEPLOYMENT_BLOCK;

    constructor(address token, address oracle, uint256 feeBps) {
        if (token == address(0)) revert ZeroAddress();
        if (oracle == address(0)) revert ZeroAddress();
        if (feeBps > 10_000) revert InvalidFee(feeBps);

        TOKEN = token;
        ORACLE = oracle;
        FEE_BPS = feeBps;
        DEPLOYMENT_BLOCK = block.number;
    }
}
```

## Initializer for Upgradeable Contracts

Proxies never call the implementation's constructor. Use `initializer` from OpenZeppelin.

```solidity
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract VaultV1 is Initializable, OwnableUpgradeable, PausableUpgradeable {
    uint256 public depositCap;
    address public feeRecipient;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address _feeRecipient,
        uint256 _depositCap
    ) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();

        __Ownable_init(admin);
        __Pausable_init();

        feeRecipient = _feeRecipient;
        depositCap = _depositCap;
    }
}
```

### Critical: Disable Initializers in Implementation

Without `_disableInitializers()`, an attacker can call `initialize()` on the implementation contract directly and potentially `selfdestruct` it (pre-Dencun) or manipulate its state.

```solidity
/// @custom:oz-upgrades-unsafe-allow constructor
constructor() {
    _disableInitializers();
}
```

### Reinitializer for Upgrades

When adding new state in V2, use `reinitializer(2)` instead of `initializer`.

```solidity
contract VaultV2 is VaultV1 {
    uint256 public withdrawalDelay;

    function initializeV2(uint256 _withdrawalDelay) external reinitializer(2) {
        withdrawalDelay = _withdrawalDelay;
    }
}
```

## Immutables + Initializers

Immutables can coexist with initializers. They're set in the implementation's constructor.

```solidity
contract VaultImplementation is Initializable, OwnableUpgradeable {
    address public immutable WETH;
    address public immutable FACTORY;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address weth, address factory) {
        if (weth == address(0)) revert ZeroAddress();
        if (factory == address(0)) revert ZeroAddress();

        WETH = weth;
        FACTORY = factory;
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __Ownable_init(admin);
    }
}
```

## Factory Patterns

### Minimal Clone Factory (EIP-1167)

Cheapest deployment for contracts with identical logic but different state.

```solidity
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract VaultFactory {
    using Clones for address;

    address public immutable IMPLEMENTATION;

    event VaultCreated(address indexed vault, address indexed admin);

    constructor(address implementation) {
        IMPLEMENTATION = implementation;
    }

    function createVault(address admin, bytes32 salt) external returns (address vault) {
        vault = IMPLEMENTATION.cloneDeterministic(salt);
        IVault(vault).initialize(admin);
        emit VaultCreated(vault, admin);
    }

    function predictVaultAddress(bytes32 salt) external view returns (address) {
        return IMPLEMENTATION.predictDeterministicAddress(salt);
    }
}
```

### CREATE2 Factory

Deterministic addresses — compute the address before deployment.

```solidity
contract Create2Factory {
    event Deployed(address indexed addr, bytes32 indexed salt);

    function deploy(bytes memory bytecode, bytes32 salt) external returns (address addr) {
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(addr) { revert(0, 0) }
        }
        emit Deployed(addr, salt);
    }

    function computeAddress(bytes memory bytecode, bytes32 salt) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            keccak256(bytecode)
        )))));
    }
}
```

### CREATE2 + Constructor Args

```solidity
function deployWithArgs(bytes32 salt, address token, uint256 fee)
    external
    returns (address vault)
{
    bytes memory bytecode = abi.encodePacked(
        type(Vault).creationCode,
        abi.encode(token, fee)
    );

    assembly {
        vault := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        if iszero(vault) { revert(0, 0) }
    }
}
```

## Constructor vs Initializer Decision Tree

```
Is the contract upgradeable?
├── No  → Use constructor + immutables
└── Yes → Use initializer + _disableInitializers()
          │
          Are there deploy-time constants (WETH, factory)?
          ├── Yes → Set as immutables in constructor
          └── No  → Everything in initializer
```

## Anti-Patterns

- **Missing `_disableInitializers()`** — allows initialization of implementation
- **Constructor logic in upgradeable contract** — runs on implementation, not proxy
- **Initializer without reentrancy protection** — OpenZeppelin's `initializer` handles this
- **Forgetting `reinitializer(n)`** for V2+ upgrades — reusing `initializer` fails silently
- **Setting storage in constructor of upgradeable** — sets implementation storage, not proxy

## Checklist

- [ ] Non-upgradeable: constructor sets immutables, validates all parameters
- [ ] Upgradeable: `_disableInitializers()` in constructor
- [ ] Upgradeable: `initializer` modifier on `initialize()`
- [ ] Upgradeable V2+: `reinitializer(n)` for upgrade initialization
- [ ] All address parameters checked against `address(0)`
- [ ] Numeric parameters validated against bounds
- [ ] Factory: deterministic deployment uses salt from meaningful context
- [ ] CREATE2: address pre-computation tested before mainnet deployment
