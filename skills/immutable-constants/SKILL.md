---
name: immutable-constants
description: Proper use of immutable and constant variables for gas savings and correctness. Use when deploying contracts with fixed configuration, optimizing gas, or deciding between constant, immutable, and storage variables.
---

# Immutable & Constant Variables

## When to Use Each

| Type | Set At | Stored In | SLOAD Cost | Use Case |
|------|--------|-----------|------------|----------|
| `constant` | Compile time | Bytecode (inlined) | 0 gas | Known at write time: math constants, hashes, selectors |
| `immutable` | Deploy time (constructor) | Bytecode (appended) | 0 gas | Known at deploy: addresses, chain IDs, config |
| Storage | Runtime | Storage slot | 2,100 cold / 100 warm | Must change after deployment |

## Constant Variables

Must be known at compile time. Value is inlined everywhere it's used.

```solidity
contract Constants {
    // Numeric constants
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 public constant RAY = 1e27;
    uint256 public constant PRECISION = 1e18;

    // Hash constants — computed at compile time
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // EIP-712 type hashes
    bytes32 public constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    // EIP-1967 slots
    bytes32 internal constant _IMPLEMENTATION_SLOT =
        bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    // Selector constants
    bytes4 public constant TRANSFER_SELECTOR = IERC20.transfer.selector;
}
```

### What Can Be Constant

- Literal values (`uint256`, `int256`, `bool`, `address`, `bytes1`-`bytes32`)
- `keccak256()` of literal values
- Expressions evaluated at compile time
- **Cannot** be `constant`: values depending on runtime state, `block.timestamp`, `msg.sender`

## Immutable Variables

Set once in the constructor, stored in bytecode. Cannot be changed after deployment.

```solidity
contract ImmutableConfig {
    address public immutable WETH;
    address public immutable FACTORY;
    address public immutable ORACLE;
    uint256 public immutable DEPLOYMENT_CHAIN_ID;
    uint256 public immutable CREATED_AT;
    uint8 public immutable UNDERLYING_DECIMALS;

    constructor(
        address weth,
        address factory,
        address oracle,
        address underlying
    ) {
        if (weth == address(0)) revert ZeroAddress();
        if (factory == address(0)) revert ZeroAddress();
        if (oracle == address(0)) revert ZeroAddress();

        WETH = weth;
        FACTORY = factory;
        ORACLE = oracle;
        DEPLOYMENT_CHAIN_ID = block.chainid;
        CREATED_AT = block.timestamp;
        UNDERLYING_DECIMALS = IERC20Metadata(underlying).decimals();
    }
}
```

### Immutable Rules

- Must be assigned in the constructor (or inline for simple expressions)
- Cannot be assigned in any other function
- Cannot be used in upgradeable contracts with initializers (no constructor runs)
- Value types only: `address`, `uint*`, `int*`, `bool`, `bytes1`-`bytes32`
- **Cannot** be `immutable`: `string`, `bytes`, arrays, structs, mappings

## Gas Comparison

```solidity
contract GasComparison {
    // Storage: 2,100 gas cold SLOAD, 100 gas warm SLOAD
    address public storageVar;

    // Immutable: 0 gas — loaded from bytecode via PUSH32
    address public immutable immutableVar;

    // Constant: 0 gas — inlined at every usage site
    uint256 public constant CONSTANT_VAR = 42;

    constructor(address _addr) {
        storageVar = _addr;
        immutableVar = _addr;
    }

    // Reading storageVar:   ~2,100 gas (cold) or ~100 gas (warm)
    // Reading immutableVar:     ~3 gas (PUSH32)
    // Reading CONSTANT_VAR:     ~3 gas (PUSH32, inlined)
}
```

### Real-World Savings

For a function that reads an address 3 times:
- Storage: 2,100 + 100 + 100 = **2,300 gas**
- Immutable: 3 + 3 + 3 = **9 gas** (savings: 2,291 gas)

## Bytes32 vs String for Constants

```solidity
// BAD: string constant — still uses dynamic encoding
string public constant NAME = "MyProtocol";

// GOOD: bytes32 constant — fixed size, cheaper to read and compare
bytes32 public constant NAME = "MyProtocol";

// Converting bytes32 to string (offchain or in rare onchain cases)
function nameAsString() external pure returns (string memory) {
    return string(abi.encodePacked(NAME));
}
```

## Naming Conventions

```solidity
// Constants: UPPER_SNAKE_CASE
uint256 public constant MAX_SUPPLY = 1_000_000e18;

// Immutables: UPPER_SNAKE_CASE (they're functionally constant post-deploy)
address public immutable TREASURY;

// Storage variables: camelCase
uint256 public totalDeposited;
```

## Immutables in Upgradeable Contracts

Immutables are stored in bytecode, not storage. In upgradeable proxies, the proxy reads the **implementation's** bytecode. This means immutables can be used in implementations — they're set in the implementation's constructor (which runs at deployment, not through the proxy).

```solidity
contract VaultImplementation is Initializable {
    // These are set when the implementation contract is deployed
    address public immutable WETH;
    address public immutable FACTORY;

    constructor(address weth, address factory) {
        WETH = weth;
        FACTORY = factory;
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        // Storage variables set here (via proxy's storage)
        __Ownable_init(admin);
    }
}
```

## Checklist

- [ ] All values known at compile time are `constant`
- [ ] All values known at deploy time (but not compile time) are `immutable`
- [ ] Only values that change post-deployment use storage
- [ ] Constructor validates all immutable values (zero-address checks)
- [ ] UPPER_SNAKE_CASE naming for both `constant` and `immutable`
- [ ] `bytes32` preferred over `string` for short constant strings
- [ ] Immutables in upgradeable contracts are in the implementation constructor
