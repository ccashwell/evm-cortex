# Security-First Development

## Core Principle
Every Solidity function is a potential attack vector. Write defensively. Think like an auditor.

## Checks-Effects-Interactions Pattern
ALWAYS follow this order:
1. **Checks** — validate inputs, verify permissions, check preconditions
2. **Effects** — update state variables
3. **Interactions** — make external calls

```solidity
function withdraw(uint256 amount) external {
    // CHECKS
    if (amount > balances[msg.sender]) revert InsufficientBalance();

    // EFFECTS
    balances[msg.sender] -= amount;

    // INTERACTIONS
    (bool success,) = msg.sender.call{value: amount}("");
    if (!success) revert TransferFailed();
}
```

## Mandatory Patterns
- Use `ReentrancyGuard` on any function that makes external calls
- Use `SafeERC20` for ALL token transfers (USDT does not return bool)
- Use `Ownable2Step` over `Ownable` (prevents accidental ownership transfer)
- Use custom errors over require strings (gas efficiency + clarity)
- Validate ALL inputs at function boundaries
- Never trust external call return data without validation
- Never use `tx.origin` for authorization

## Token Safety
- USDC has 6 decimals, not 18
- USDT `transfer()` does not return bool — use SafeERC20
- Fee-on-transfer tokens: received amount != sent amount
- Rebasing tokens (stETH): balance changes without transfers
- ERC-777 tokens: callbacks enable reentrancy

## Access Control
- Every state-changing function needs explicit access control
- Use timelock for admin functions that affect user funds
- Multi-sig for protocol-critical operations
- Document all privileged roles and their capabilities

## External Calls
- Check return values of low-level calls
- Set gas limits for untrusted external calls
- Never delegatecall to untrusted addresses
- Protect against return bomb attacks (limit returndata copy)

## Arithmetic
- Solidity 0.8+ has overflow protection by default
- Use `unchecked` blocks ONLY when overflow is mathematically impossible
- Watch for phantom overflow in intermediate calculations
- Use safe casting between integer sizes
