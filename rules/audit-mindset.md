# Audit Mindset

## Principle
Write code as if it will be audited tomorrow. Document invariants. Question every assumption.

## When Writing Code
- For every state change: what could go wrong?
- For every external call: what if it reenters?
- For every math operation: what if the values are extreme?
- For every access control: what if it's bypassed?
- For every token interaction: what if the token is non-standard?

## Document Invariants
Every protocol has invariants that must always hold:
```solidity
// INVARIANT: totalShares * assetPerShare == totalAssets (within rounding)
// INVARIANT: sum of all user balances == totalSupply
// INVARIANT: collateralValue >= borrowValue * minCollateralRatio
```

Write these as comments AND as invariant tests.

## Common Questions to Ask
1. What happens with zero amount?
2. What happens with type(uint256).max?
3. What happens when the contract is empty?
4. What happens on first deposit / last withdrawal?
5. Who can call this function? Should they be able to?
6. What if this external call fails or returns unexpected data?
7. What if two users interact in the same block?
8. Can a flash loan exploit this?
9. What MEV opportunities does this create?
10. What happens if the oracle returns stale or zero price?

## Severity Classification
| Severity | Impact | Likelihood |
|----------|--------|------------|
| Critical | Fund loss, protocol broken | Likely/certain |
| High | Significant fund loss or DoS | Possible |
| Medium | Limited fund loss, griefing | Possible |
| Low | Minor issues, informational | Unlikely |

## Pre-Commit Checklist
- [ ] No hardcoded addresses or private keys
- [ ] All external calls checked for return value
- [ ] ReentrancyGuard on functions with external calls
- [ ] Access control on all state-changing functions
- [ ] Events emitted for all state changes
- [ ] NatSpec on all public/external functions
- [ ] Edge cases tested (0, 1, max, empty state)
