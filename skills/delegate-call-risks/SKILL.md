---
name: delegate-call-risks
description: Delegatecall risks and safety patterns for Solidity proxies and modular contracts. Use when implementing upgradeable proxies, diamond patterns, or any contract using delegatecall. Covers storage layout requirements, context preservation, and implementation safety.
---

# Delegatecall Risks

## How Delegatecall Works

`delegatecall` executes the target's code in the **caller's** context: the caller's storage, `msg.sender`, `msg.value`, and `address(this)` are preserved.

```
Proxy (storage)  →  delegatecall  →  Implementation (code)
- slot 0: admin      executes in       reads/writes Proxy's storage
- slot 1: value      Proxy context      msg.sender = original caller
```

## Storage Layout Must Match

The proxy and implementation must have identical storage layouts. Delegatecall operates on slot numbers, not variable names.

```solidity
// PROXY storage layout:
// slot 0: address admin
// slot 1: uint256 totalDeposits

// Implementation V1 — MUST match proxy layout
contract VaultV1 {
    address public admin;        // slot 0 ✓
    uint256 public totalDeposits; // slot 1 ✓
}

// Implementation V2 — DANGEROUS: inserted variable shifts layout
contract VaultV2Bad {
    address public admin;           // slot 0 ✓
    address public feeRecipient;    // slot 1 ✗ (was totalDeposits!)
    uint256 public totalDeposits;   // slot 2 ✗ (shifted!)
}

// Implementation V2 — SAFE: appended variable
contract VaultV2Good {
    address public admin;           // slot 0 ✓
    uint256 public totalDeposits;   // slot 1 ✓
    address public feeRecipient;    // slot 2 (new, appended)
}
```

## Context Preservation

Inside a delegatecall, all context variables refer to the proxy:

```solidity
contract Implementation {
    function whoAmI() external view returns (address self, address sender, uint256 val) {
        self = address(this);    // proxy address (NOT implementation)
        sender = msg.sender;     // original caller (NOT proxy)
        val = msg.value;         // original value sent to proxy
    }
}
```

## Proxy Initialization Attack

If the implementation contract's `initialize()` isn't disabled, an attacker can call it directly.

```solidity
// VULNERABLE: implementation can be initialized
contract VaultImpl is Initializable {
    function initialize(address admin) external initializer {
        _admin = admin;
    }
}
// Attacker calls VaultImpl.initialize(attackerAddress) directly

// SAFE: disable initializers in constructor
contract VaultImpl is Initializable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        _admin = admin;
    }
}
```

## Implementation Slot Poisoning

Pre-Dencun, an attacker could initialize the implementation and then `selfdestruct` it, bricking all proxies pointing to it.

```solidity
// Pre-Dencun attack (selfdestruct still worked):
// 1. Call initialize() on implementation → become owner
// 2. Call selfdestruct → implementation code deleted
// 3. All proxies delegatecall to empty address → all calls succeed with no-op
// 4. Protocol is bricked

// Defense: _disableInitializers() + no selfdestruct in implementation
// Post-Dencun: selfdestruct only sends ETH, doesn't delete code (EIP-6780)
```

## Delegatecall to Untrusted Contracts

Never delegatecall to an address controlled by users or external parties.

```solidity
// VULNERABLE: user controls the target
function execute(address target, bytes calldata data) external {
    (bool success,) = target.delegatecall(data); // target can write to any storage slot
    require(success);
}

// SAFE: restrict to known, audited implementations
mapping(address => bool) public approvedImplementations;

function execute(address target, bytes calldata data) external onlyOwner {
    if (!approvedImplementations[target]) revert UnapprovedTarget();
    (bool success,) = target.delegatecall(data);
    if (!success) revert ExecutionFailed();
}
```

## Function Selector Clashing

In UUPS/Transparent proxies, if the proxy and implementation have functions with the same selector, one will shadow the other.

```solidity
// Transparent Proxy pattern avoids this:
// - Admin calls → handled by proxy (upgrade functions)
// - Non-admin calls → delegated to implementation

// UUPS pattern: implementation handles upgrades
// Risk: custom function selector collides with upgradeTo(address)
// Always check: forge inspect Contract methodIdentifiers
```

### Checking for Selector Collisions

```bash
# List all function selectors
forge inspect src/Vault.sol:Vault methodIdentifiers

# Compare proxy and implementation selectors for collisions
# Any match = potential shadowing issue
```

## Storage Gap Pattern

Reserve storage slots in base contracts for future upgrades.

```solidity
abstract contract BaseVaultV1 {
    uint256 public totalDeposits;
    mapping(address => uint256) public balances;

    uint256[48] private __gap; // reserve 48 slots
}

// V2: add new variable, reduce gap
abstract contract BaseVaultV2 {
    uint256 public totalDeposits;
    mapping(address => uint256) public balances;
    uint256 public withdrawalDelay; // new in V2

    uint256[47] private __gap; // 48 - 1 = 47
}
```

## EIP-1967 Standard Slots

Proxy metadata stored at pseudo-random slots to avoid collisions with implementation storage.

```solidity
// Implementation address slot
bytes32 constant IMPLEMENTATION_SLOT =
    0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

// Admin address slot
bytes32 constant ADMIN_SLOT =
    0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

function _getImplementation() internal view returns (address impl) {
    assembly {
        impl := sload(IMPLEMENTATION_SLOT)
    }
}
```

## UUPS vs Transparent Proxy

| Feature | UUPS | Transparent |
|---------|------|------------|
| Upgrade logic | In implementation | In proxy |
| Gas cost per call | Lower (no admin check) | Higher (admin check every call) |
| Deploy cost | Lower proxy | Higher proxy |
| Risk | Forget upgradeTo in new impl → bricked | More gas per user call |
| Admin collision | Possible | Prevented by admin routing |

## Delegatecall Safety Checklist

- [ ] Storage layout verified with `forge inspect --storage-layout` before upgrade
- [ ] New variables only appended, never inserted
- [ ] `__gap` reduced by correct amount for new variables
- [ ] `_disableInitializers()` in implementation constructor
- [ ] No `selfdestruct` in implementation code
- [ ] No delegatecall to user-controlled addresses
- [ ] Function selector collisions checked between proxy and implementation
- [ ] Inheritance order unchanged between versions
- [ ] OpenZeppelin Upgrades plugin used for validation
- [ ] Upgrade tested on fork before mainnet
