---
name: solidity-security
description: Security-focused Solidity development patterns. Use when writing contracts that handle funds, interact with external tokens, or accept user input. Covers reentrancy guards, SafeERC20, access control, input validation, integer safety, and safe external calls.
---

# Solidity Security Fundamentals

## Reentrancy Guards

Always use ReentrancyGuard on functions with external interactions, even when following CEI.

```solidity
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Vault is ReentrancyGuard {
    mapping(address => uint256) public balances;

    function withdraw(uint256 amount) external nonReentrant {
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
```

## SafeERC20 — Always Use It

Token contracts are not standardized in practice. USDT does not return a bool on `transfer`. USDC uses 6 decimals (not 18). Some tokens have fee-on-transfer. Always use SafeERC20.

```solidity
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenVault {
    using SafeERC20 for IERC20;

    function deposit(IERC20 token, uint256 amount) external {
        // SafeERC20 handles non-standard return values
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(IERC20 token, uint256 amount) external {
        token.safeTransfer(msg.sender, amount);
    }

    function approveSpender(IERC20 token, address spender, uint256 amount) external {
        // forceApprove handles tokens requiring approval reset to 0 first (USDT)
        token.forceApprove(spender, amount);
    }
}
```

### Token Decimal Gotchas

```solidity
// WRONG: assuming 18 decimals
uint256 oneToken = 1e18;

// RIGHT: query decimals
uint8 decimals = IERC20Metadata(address(token)).decimals();
uint256 oneToken = 10 ** decimals;

// Common decimals:
// USDC: 6 decimals  (1 USDC = 1e6)
// USDT: 6 decimals  (1 USDT = 1e6)
// WBTC: 8 decimals  (1 WBTC = 1e8)
// DAI:  18 decimals (1 DAI  = 1e18)
// WETH: 18 decimals (1 WETH = 1e18)
```

## Access Control

Use `Ownable2Step` over `Ownable` to prevent accidental ownership transfer to a wrong address.

```solidity
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract Protocol is Ownable2Step {
    constructor(address initialOwner) Ownable(initialOwner) {}

    function emergencyPause() external onlyOwner {
        _pause();
    }
}
```

For multi-role systems, use `AccessControl`:

```solidity
bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

function pause() external onlyRole(PAUSER_ROLE) {
    _pause();
}
```

## Input Validation

Validate everything at system boundaries. Trust nothing from external callers.

```solidity
error ZeroAddress();
error ZeroAmount();
error InvalidBps(uint256 bps);
error ArrayLengthMismatch();
error ExceedsMaximum(uint256 value, uint256 maximum);

function setFee(uint256 feeBps) external onlyOwner {
    if (feeBps > 10_000) revert InvalidBps(feeBps);
    fee = feeBps;
}

function batchTransfer(address[] calldata recipients, uint256[] calldata amounts) external {
    if (recipients.length != amounts.length) revert ArrayLengthMismatch();
    if (recipients.length == 0) revert ZeroAmount();

    for (uint256 i; i < recipients.length; ++i) {
        if (recipients[i] == address(0)) revert ZeroAddress();
        if (amounts[i] == 0) revert ZeroAmount();
        _transfer(recipients[i], amounts[i]);
    }
}
```

## Safe External Calls

Never trust return data from arbitrary external calls.

```solidity
function safeCall(address target, bytes calldata data)
    external
    returns (bytes memory)
{
    if (target.code.length == 0) revert NotAContract(target);

    (bool success, bytes memory returndata) = target.call(data);

    if (!success) {
        // Bubble up the revert reason
        if (returndata.length > 0) {
            assembly {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }
        revert CallFailed(target);
    }

    return returndata;
}
```

## ETH Transfer Safety

```solidity
// BAD: transfer() has 2300 gas stipend, can break with EIP-1884
payable(recipient).transfer(amount);

// BAD: send() silently fails
payable(recipient).send(amount);

// GOOD: low-level call with success check
(bool success,) = recipient.call{value: amount}("");
if (!success) revert ETHTransferFailed();
```

## Preventing Self-Destruct Force-Send

Contracts can receive ETH via `selfdestruct` even without `receive()`. Never rely on `address(this).balance` for accounting.

```solidity
// BAD: relies on contract balance
function totalDeposits() external view returns (uint256) {
    return address(this).balance;
}

// GOOD: track deposits explicitly
uint256 public totalDeposited;

function deposit() external payable {
    totalDeposited += msg.value;
}
```

## Security Checklist

- [ ] All external calls follow checks-effects-interactions
- [ ] ReentrancyGuard on functions with external interactions
- [ ] SafeERC20 for all token operations
- [ ] `forceApprove` instead of `approve` for USDT compatibility
- [ ] No assumption of 18 decimals
- [ ] `Ownable2Step` over `Ownable`
- [ ] Zero-address checks on all address parameters
- [ ] Array length validation for batch operations
- [ ] `call{}` instead of `transfer()`/`send()` for ETH
- [ ] Explicit accounting (don't rely on `address(this).balance`)
- [ ] No `tx.origin` for auth
- [ ] No hardcoded gas limits on external calls
- [ ] Events emitted for all state changes
