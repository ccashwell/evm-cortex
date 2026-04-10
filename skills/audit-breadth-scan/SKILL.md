---
name: audit-breadth-scan
description: Use when performing systematic breadth-first review of all contracts during a security audit. Covers contract-by-contract review, function-level risk assessment, attack surface mapping, and identifying leads for depth analysis.
---

# Audit Breadth Scan

## Purpose

The breadth scan is a systematic, contract-by-contract review that ensures every function is examined at least once. The goal is NOT to find every bug — it's to identify high-risk areas that warrant depth analysis.

## Methodology

### Pass 1: Contract-Level Assessment

For each contract in scope, assess:

```markdown
## [Contract Name] — Breadth Assessment

### Overview
- Lines of code: X
- Inheritance chain: A -> B -> C
- State variables: Y
- External calls: Z

### Complexity Rating: [Low | Medium | High | Critical]
Factors: math complexity, external interactions, state machine logic,
         upgrade mechanics, cross-contract dependencies

### Initial Risk Notes
- [Any patterns that stand out]
```

### Pass 2: Function-Level Risk Assessment

Rate each function on a risk matrix:

| Risk Factor | Weight | Criteria |
|-------------|--------|----------|
| External calls | High | Calls to untrusted contracts |
| State changes | Medium | Modifies critical state (balances, shares) |
| Math operations | Medium | Division, multiplication with large numbers |
| Access control | High | Missing or incorrect |
| Value transfer | Critical | ETH or token movement |
| User input | Medium | Complex parameter handling |

```markdown
### Function Risk Matrix

| Function | External Calls | State Change | Math | Value Transfer | Risk |
|----------|---------------|--------------|------|----------------|------|
| deposit() | transferFrom | balances, supply | share calc | tokens in | HIGH |
| withdraw() | transfer, strategy | balances, supply | share calc | tokens out | CRITICAL |
| setFee() | none | fee param | none | none | LOW |
| harvest() | aave.withdraw | deployed amount | yield calc | tokens move | HIGH |
```

### Pass 3: Attack Surface Mapping

For each high/critical risk function, map potential attack vectors:

```markdown
### Attack Surface: withdraw()

**Preconditions**: User has shares, vault has assets

**Attack Vectors**:
1. Reentrancy via token callback (ERC777, hooks)
   - Mitigation: ReentrancyGuard
   - Status: CHECK if guard applied

2. Share price manipulation
   - Donate tokens to inflate totalAssets before withdraw
   - Status: CHECK virtual shares mitigation

3. Front-running
   - Sandwich attack around large withdrawals
   - Status: CHECK slippage protection

4. Oracle manipulation
   - Stale/manipulated price affects withdrawal amount
   - Status: CHECK staleness validation

5. Integer overflow/underflow
   - Share calculation edge cases
   - Status: CHECK Solidity 0.8 overflow protection
```

## Common Vulnerability Patterns to Check

### High Priority
```
□ Reentrancy (state changes after external calls)
□ Access control missing or bypassable
□ Oracle manipulation / stale prices
□ Flash loan attack vectors
□ Integer overflow in unchecked blocks
□ First depositor / share inflation attacks
□ Frontrunning / sandwich attacks
□ Unauthorized token approvals
□ Improper input validation
```

### Medium Priority
```
□ Centralization risks (owner can rug)
□ Denial of service (gas griefing, reverts)
□ Rounding errors favoring attacker
□ Event emission correctness
□ Return value handling (unchecked transfers)
□ Storage collision (proxies)
□ Signature replay / malleability
□ Block timestamp dependence
```

### Low Priority
```
□ Gas optimization opportunities
□ Code quality / readability
□ Missing error messages
□ Unused variables / imports
□ Inconsistent naming
□ Missing NatSpec documentation
```

## Breadth Scan Report Template

For each contract:

```markdown
## Vault.sol — Breadth Scan

### Functions Reviewed: 12/12
### Risk Rating: HIGH

### Findings (leads for depth)
| ID | Function | Pattern | Confidence | Depth Priority |
|----|----------|---------|------------|----------------|
| B-01 | withdraw | Possible reentrancy before state update | Medium | P0 |
| B-02 | deposit | No check for zero shares | High | P1 |
| B-03 | harvest | Unchecked return value from strategy | Medium | P1 |
| B-04 | setOracle | No timelock on oracle change | High | P2 |

### Clean Areas (no further review needed)
- Constructor: correctly initializes all state
- View functions: no state modifications
- Pause mechanism: standard OZ implementation
```

## Timing Guidelines

| Project Size | Breadth Time | Depth Time | Report |
|-------------|-------------|------------|--------|
| < 500 SLOC | 2-4 hours | 4-8 hours | 2 hours |
| 500-2000 SLOC | 1-2 days | 2-4 days | 1 day |
| 2000-5000 SLOC | 2-3 days | 4-6 days | 1-2 days |
| > 5000 SLOC | 3-5 days | 5-10 days | 2-3 days |

## Transition to Depth Analysis

After breadth scan, prioritize depth analysis leads:

- **P0**: Likely vulnerability, high impact → analyze immediately
- **P1**: Suspicious pattern, needs verification → analyze next
- **P2**: Possible issue, lower impact → analyze if time permits
- **P3**: Informational / optimization → include in report as-is

## Checklist

- [ ] Every contract in scope reviewed
- [ ] Every external/public function risk-assessed
- [ ] Attack surfaces mapped for high-risk functions
- [ ] Common vulnerability patterns checked against each contract
- [ ] Depth analysis leads prioritized (P0-P3)
- [ ] Clean areas documented (saves time later)
- [ ] Breadth scan notes organized per contract
- [ ] Automated tool findings cross-referenced with manual review
