---
name: interface-design
description: Interface and abstract contract design patterns for Solidity protocols. Use when designing modular contract systems, defining protocol standards, implementing EIP-165, or structuring inheritance hierarchies.
---

# Interface Design

## Interface Principles

Interfaces define the external API of your protocol. They are the contract between your system and its integrators.

```solidity
// Minimal, focused interface — one concern per interface
interface IVault {
    function deposit(address token, uint256 amount) external returns (uint256 shares);
    function withdraw(address token, uint256 shares) external returns (uint256 amount);
    function balanceOf(address user, address token) external view returns (uint256);
}

// Separate admin interface
interface IVaultAdmin {
    function setFee(uint256 feeBps) external;
    function pause() external;
    function unpause() external;
}

// Separate events interface — inheritable without implementation obligation
interface IVaultEvents {
    event Deposited(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, address indexed token, uint256 amount, uint256 shares);
}
```

## Abstract Contracts vs Interfaces

| Feature | Interface | Abstract Contract |
|---------|-----------|-------------------|
| State variables | No | Yes |
| Constructor | No | Yes |
| Function implementations | No | Partial |
| Inheritance | Multiple | Multiple (with care) |
| Use case | External API definition | Shared base logic |

```solidity
// Abstract contract: provides base implementation with extension points
abstract contract BaseVault is IVault, IVaultEvents, ReentrancyGuard {
    mapping(address => mapping(address => uint256)) internal _shares;

    function deposit(address token, uint256 amount)
        external
        virtual
        nonReentrant
        returns (uint256 shares)
    {
        shares = _convertToShares(token, amount);
        _shares[msg.sender][token] += shares;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount, shares);
    }

    // Extension point — subclasses define share calculation
    function _convertToShares(address token, uint256 amount)
        internal
        view
        virtual
        returns (uint256);
}
```

## Virtual / Override

Use `virtual` to mark functions that can be overridden. Use `override` to implement them. Use both when a middle-layer contract overrides but allows further overriding.

```solidity
abstract contract Pausable {
    bool public paused;

    modifier whenNotPaused() virtual {
        require(!paused, "Paused");
        _;
    }

    function _pause() internal virtual {
        paused = true;
    }
}

contract Vault is Pausable {
    function deposit(uint256 amount) external whenNotPaused {
        // ...
    }

    // Override to add event emission
    function _pause() internal override {
        super._pause();
        emit VaultPaused(block.timestamp);
    }
}
```

## EIP-165: supportsInterface

Implement `supportsInterface` to allow onchain interface detection.

```solidity
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract MyToken is IERC165, IERC721 {
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return
            interfaceId == type(IERC165).interfaceId ||   // 0x01ffc9a7
            interfaceId == type(IERC721).interfaceId ||   // 0x80ac58cd
            interfaceId == type(IERC721Metadata).interfaceId; // 0x5b5e139f
    }
}
```

### Computing Interface IDs

```solidity
// Interface ID = XOR of all function selectors in the interface
bytes4 constant IERC721_ID = bytes4(
    keccak256("balanceOf(address)") ^
    keccak256("ownerOf(uint256)") ^
    keccak256("safeTransferFrom(address,address,uint256,bytes)") ^
    keccak256("safeTransferFrom(address,address,uint256)") ^
    keccak256("transferFrom(address,address,uint256)") ^
    keccak256("approve(address,uint256)") ^
    keccak256("setApprovalForAll(address,bool)") ^
    keccak256("getApproved(uint256)") ^
    keccak256("isApprovedForAll(address,address)")
);

// Or use Solidity's built-in:
bytes4 id = type(IERC721).interfaceId;
```

## Callback Interfaces

Define callback interfaces for contracts that need to be notified of actions (flash loans, token receipts).

```solidity
interface IFlashLoanReceiver {
    /// @notice Called by the lending pool after transferring the flash loan amount.
    /// @param token The address of the token borrowed.
    /// @param amount The amount borrowed.
    /// @param fee The fee to be paid on top of the borrowed amount.
    /// @param data Arbitrary data passed through from the flash loan initiator.
    /// @return Must return the keccak256 hash of "IFlashLoanReceiver.onFlashLoan"
    function onFlashLoan(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}

// Verify callback return value
bytes32 constant CALLBACK_SUCCESS = keccak256("IFlashLoanReceiver.onFlashLoan");

function flashLoan(address receiver, address token, uint256 amount, bytes calldata data) external {
    IERC20(token).safeTransfer(receiver, amount);

    bytes32 result = IFlashLoanReceiver(receiver).onFlashLoan(token, amount, fee, data);
    if (result != CALLBACK_SUCCESS) revert InvalidCallbackReturn();

    IERC20(token).safeTransferFrom(receiver, address(this), amount + fee);
}
```

## Diamond Inheritance

Solidity uses C3 linearization for multiple inheritance. Be explicit about resolution.

```solidity
contract A {
    function foo() public virtual returns (string memory) { return "A"; }
}

contract B is A {
    function foo() public virtual override returns (string memory) { return "B"; }
}

contract C is A {
    function foo() public virtual override returns (string memory) { return "C"; }
}

// Must explicitly override — compiler enforces it
contract D is B, C {
    function foo() public override(B, C) returns (string memory) {
        return super.foo(); // calls C.foo() (rightmost parent in linearization)
    }
}
```

## Interface Design Checklist

- [ ] One concern per interface (separate user-facing from admin)
- [ ] Events in their own interface for clean inheritance
- [ ] EIP-165 `supportsInterface` implemented for discoverable contracts
- [ ] Callback interfaces return a magic value for verification
- [ ] `virtual` on functions intended for extension
- [ ] NatSpec on all interface functions
- [ ] Abstract contracts for shared base logic with extension points
- [ ] Inheritance order consistent across the codebase
- [ ] No diamond inheritance without explicit `override(A, B)` resolution
