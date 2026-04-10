---
name: access-control-patterns
description: Access control design patterns for Solidity protocols. Use when implementing role-based permissions, timelocks, emergency controls, or multi-sig requirements. Covers Ownable2Step, AccessControl, AccessManager, timelock patterns, and emergency pause.
---

# Access Control Patterns

## Ownable2Step (Preferred over Ownable)

Two-step ownership transfer prevents accidental transfer to a wrong address.

```solidity
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract Treasury is Ownable2Step {
    constructor(address initialOwner) Ownable(initialOwner) {}

    function withdrawFunds(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}

// Transfer flow:
// 1. Current owner calls transferOwnership(newOwner)
// 2. newOwner calls acceptOwnership()
// 3. Ownership transferred only after step 2
```

## Role-Based Access Control

For protocols needing multiple permission levels.

```solidity
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract Protocol is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function updateParameters(uint256 newFee) external onlyRole(OPERATOR_ROLE) {
        // routine parameter updates
    }

    function emergencyPause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function withdrawFees(address to) external onlyRole(TREASURY_ROLE) {
        // treasury management
    }
}
```

### Role Hierarchy Template

```
DEFAULT_ADMIN_ROLE (multisig/timelock)
├── OPERATOR_ROLE (parameter updates, routine operations)
├── GUARDIAN_ROLE (emergency pause, circuit breakers)
├── TREASURY_ROLE (fee collection, fund management)
├── UPGRADER_ROLE (proxy upgrades — timelock only)
└── MINTER_ROLE (token minting — restricted)
```

### Custom Role Admin

```solidity
constructor(address admin) {
    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    // OPERATOR_ROLE is managed by DEFAULT_ADMIN_ROLE (default)
    // GUARDIAN can manage itself (guardians can add/remove other guardians)
    _setRoleAdmin(GUARDIAN_ROLE, GUARDIAN_ROLE);

    // MINTER is managed by OPERATOR (operators control minters)
    _setRoleAdmin(MINTER_ROLE, OPERATOR_ROLE);
}
```

## AccessManager (OpenZeppelin 5.x)

Centralized permission management for complex protocols with multiple contracts.

```solidity
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";

contract Vault is AccessManaged {
    constructor(address manager) AccessManaged(manager) {}

    function setFee(uint256 fee) external restricted {
        // AccessManager checks if msg.sender has permission for this function
    }
}

// In the AccessManager:
// 1. Define roles (groups of addresses)
// 2. Assign function permissions to roles
// 3. Optionally add execution delays per role
```

## Timelock Pattern

Critical operations should have a time delay, giving users time to react.

```solidity
struct TimelockOperation {
    bytes32 id;
    address target;
    uint256 value;
    bytes data;
    uint256 readyTimestamp;
    bool executed;
}

uint256 public constant MIN_DELAY = 2 days;

mapping(bytes32 => TimelockOperation) public operations;

function schedule(
    address target,
    uint256 value,
    bytes calldata data,
    uint256 delay
) external onlyRole(OPERATOR_ROLE) returns (bytes32 id) {
    if (delay < MIN_DELAY) revert DelayTooShort(delay, MIN_DELAY);

    id = keccak256(abi.encode(target, value, data, block.timestamp));

    operations[id] = TimelockOperation({
        id: id,
        target: target,
        value: value,
        data: data,
        readyTimestamp: block.timestamp + delay,
        executed: false
    });

    emit OperationScheduled(id, target, value, data, block.timestamp + delay);
}

function execute(bytes32 id) external onlyRole(OPERATOR_ROLE) {
    TimelockOperation storage op = operations[id];

    if (op.readyTimestamp == 0) revert OperationNotFound();
    if (op.executed) revert AlreadyExecuted();
    if (block.timestamp < op.readyTimestamp) revert NotReady(op.readyTimestamp);

    op.executed = true;

    (bool success,) = op.target.call{value: op.value}(op.data);
    if (!success) revert ExecutionFailed();

    emit OperationExecuted(id);
}
```

## Emergency Pause

```solidity
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract Vault is Pausable, AccessControl {
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // Guardians can pause immediately (no timelock)
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    // Unpausing requires higher privilege (admin/timelock)
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function deposit(uint256 amount) external whenNotPaused {
        // ...
    }

    // Withdrawals may remain enabled during pause
    function emergencyWithdraw() external {
        // always available — user safety
    }
}
```

### Pause Design Principles

- **Pause should be fast**: Guardian can pause without timelock
- **Unpause should be slower**: Requires admin/multisig to prevent premature resume
- **Withdrawals should survive pause**: Users must always be able to exit
- **Automatic unpause**: Consider a max pause duration to prevent permanent lockout

## Multi-Sig Requirements

For critical operations, require multiple signatures or approvals.

```solidity
mapping(bytes32 => uint256) public approvalCount;
mapping(bytes32 => mapping(address => bool)) public hasApproved;

uint256 public constant REQUIRED_APPROVALS = 3;

function approve(bytes32 operationId) external onlyRole(OPERATOR_ROLE) {
    if (hasApproved[operationId][msg.sender]) revert AlreadyApproved();

    hasApproved[operationId][msg.sender] = true;
    approvalCount[operationId] += 1;

    emit Approved(operationId, msg.sender, approvalCount[operationId]);
}

function execute(bytes32 operationId) external onlyRole(OPERATOR_ROLE) {
    if (approvalCount[operationId] < REQUIRED_APPROVALS) {
        revert InsufficientApprovals(approvalCount[operationId], REQUIRED_APPROVALS);
    }
    // ...
}
```

## Access Control Checklist

- [ ] `Ownable2Step` over `Ownable` for single-owner contracts
- [ ] `AccessControl` for multi-role protocols
- [ ] Role hierarchy documented and enforced
- [ ] Critical operations behind timelock (upgrades, parameter changes)
- [ ] Emergency pause available to guardian role (no timelock)
- [ ] Unpause requires higher privilege than pause
- [ ] Withdrawals remain functional during pause
- [ ] No single EOA controls critical functions — use multisig
- [ ] Role grants/revokes emit events for monitoring
- [ ] `renounceRole` considered for immutability guarantees post-setup
