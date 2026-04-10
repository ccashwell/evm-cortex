---
name: audit-depth-analysis
description: Use when performing deep analysis of specific findings or high-risk areas during a security audit. Covers state trace analysis, token flow tracing, edge case enumeration, cross-contract interaction analysis, invariant verification, and economic incentive analysis.
---

# Audit Depth Analysis

## When to Use

Depth analysis is applied to specific leads identified during breadth scanning. Each lead gets focused attention from one or more depth analysis techniques.

## Depth Analysis Techniques

### 1. State Trace Analysis

Trace state changes through a function to find inconsistencies:

```markdown
## State Trace: Vault.withdraw()

### Entry State
- totalAssets: 1,000,000 USDC
- totalSupply: 900,000 shares
- user.shares: 100,000
- strategy.deployed: 800,000 USDC
- vault.idle: 200,000 USDC

### Execution Trace
1. shares = previewWithdraw(assets)           // shares = 90,000
2. _spendAllowance(owner, msg.sender, shares) // approval check
3. _burn(owner, shares)                       // totalSupply: 810,000
4. strategy.withdraw(assets - idle)           // ← EXTERNAL CALL
5. token.transfer(receiver, assets)           // ← EXTERNAL CALL

### Post State
- totalAssets: 900,000 USDC
- totalSupply: 810,000 shares

### Issues Found
- Step 4: External call to strategy BEFORE state is finalized
  - If strategy.withdraw() calls back into vault → reentrancy
  - Mitigation: ReentrancyGuard present ✓
- Step 3→4: _burn reduces totalSupply before strategy withdrawal
  - If strategy.withdraw() reads totalSupply → stale value
  - Impact: share price temporarily inflated during callback
```

### 2. Token Flow Tracing

Track every token movement to find value leaks:

```markdown
## Token Flow: deposit() -> harvest() -> withdraw()

### deposit(100 USDC)
| From | To | Amount | Token |
|------|-----|--------|-------|
| User | Vault | 100 USDC | USDC |
| Vault | User | 100 shares | Vault Share |

### harvest()
| From | To | Amount | Token |
|------|-----|--------|-------|
| Aave | Strategy | 5 USDC (yield) | USDC |
| Strategy | Vault | 5 USDC | USDC |
| Vault | Treasury | 0.5 USDC (10% fee) | USDC |

### withdraw(all)
| From | To | Amount | Token |
|------|-----|--------|-------|
| User | Vault | 100 shares | Vault Share (burned) |
| Vault | User | 104.5 USDC | USDC |

### Accounting Check
In:  100 USDC (user) + 5 USDC (yield) = 105 USDC
Out: 104.5 USDC (user) + 0.5 USDC (treasury) = 105 USDC ✓
```

### 3. Edge Case Enumeration

Systematically enumerate boundary conditions:

```markdown
## Edge Cases: Vault.deposit()

### Zero/Min Values
- deposit(0) → should revert or return 0 shares
- deposit(1) → might round to 0 shares → value lost
- deposit(1) when totalAssets is very large → 0 shares (dust attack)

### Max Values
- deposit(type(uint256).max) → overflow in share calculation?
- deposit when totalSupply near type(uint256).max → overflow?

### First/Last Operations
- First deposit (totalSupply == 0) → initial share price
- First deposit attack (donate + deposit 1 wei)
- Last withdrawal (totalSupply → 0) → dust remaining

### Concurrent Operations
- Deposit during harvest → share price changes mid-tx?
- Deposit + donate in same tx → price manipulation
- Multiple deposits in same block → frontrunning

### External State
- Deposit when token is paused (USDC blacklist)
- Deposit when oracle is stale
- Deposit after strategy loss (totalAssets < totalSupply)
```

### 4. Cross-Contract Interaction Analysis

```markdown
## Cross-Contract: Vault <-> Strategy <-> Aave

### Call Chain
Vault.withdraw() → Strategy.withdraw() → Aave.withdraw() → USDC.transfer()

### Trust Assumptions at Each Boundary
1. Vault trusts Strategy return values → what if Strategy lies?
   - Strategy reports more deployed than actual → withdrawal fails
   - Strategy reports less deployed → some funds stuck

2. Strategy trusts Aave withdrawal amount → what if Aave gives less?
   - Slippage on Aave withdrawal (not normal, but possible)
   - Aave paused → Strategy.withdraw() reverts → user stuck

3. USDC.transfer → what if USDC blacklists vault?
   - All withdrawals fail
   - Mitigation: emergency mode to switch tokens?

### Reentrancy Paths
Vault → Strategy → Aave → [callback?] → Vault
- Aave V3 does not have callback reentrancy → safe
- But if Strategy uses other protocols with callbacks → check
```

### 5. Economic Incentive Analysis

```markdown
## Economic Analysis: Share Price Manipulation

### Attack: First Depositor Inflation
1. Attacker deposits 1 wei → gets 1 share
2. Attacker sends 1,000,000 USDC directly to vault
3. Share price: 1,000,000 USDC / 1 share
4. Victim deposits 999,999 USDC → gets 0 shares (rounded down)
5. Attacker redeems 1 share → gets ~2,000,000 USDC

**Mitigation Check**: Virtual shares offset present?
- VIRTUAL_SHARES = 1e3 → attack cost = 1e3 * donation = 1e9 USDC
- Cost exceeds profit → mitigated ✓

### Attack: Sandwich Vault Deposit
1. Attacker front-runs large deposit with donation
2. Donation inflates share price
3. Victim gets fewer shares
4. Attacker has no direct way to profit → not viable ✓

### Attack: Flash Loan Price Manipulation
1. Flash borrow large amount
2. Manipulate oracle price
3. Deposit at favorable rate
4. Oracle returns to normal
5. Withdraw at inflated rate

**Mitigation Check**: Oracle uses TWAP or Chainlink? Time-weighted = resistant ✓
```

## Depth Analysis Framework

```markdown
## Depth Report: [Finding ID]

### Observation
What was observed during breadth scan

### Hypothesis
What could go wrong

### Analysis
Detailed investigation using techniques above

### Proof of Concept
[Reference to PoC test or step-by-step]

### Conclusion
- Confirmed vulnerability, OR
- False positive (explain why), OR
- Informational finding

### Severity (if confirmed)
Impact: [Critical | High | Medium | Low]
Likelihood: [High | Medium | Low]
Overall: Impact × Likelihood
```

## Checklist

- [ ] Each breadth-scan lead has a depth analysis entry
- [ ] State traces cover all state-changing paths
- [ ] Token flows balance (in == out + fees)
- [ ] Edge cases enumerated for zero, min, max, first, last
- [ ] Cross-contract trust assumptions documented
- [ ] Economic incentives analyzed for attack profitability
- [ ] Reentrancy paths traced through all external calls
- [ ] Findings classified as confirmed, false positive, or informational
- [ ] Each confirmed finding has severity + rationale
