---
name: audit-report-generation
description: Use when compiling final audit reports. Covers executive summary, scope and methodology, finding format, severity classification, risk summary tables, recommendations, and appendices.
---

# Audit Report Generation

## Report Structure

```
1. Executive Summary
2. Scope & Methodology
3. System Overview
4. Findings
5. Risk Summary
6. Recommendations
7. Appendices
```

## Report Template

```markdown
# Security Audit Report

## Protocol Name — Audit Report
**Audit Period**: YYYY-MM-DD to YYYY-MM-DD
**Commit**: abc1234
**Auditor(s)**: [Names]
**Report Version**: 1.0

---

## 1. Executive Summary

[Protocol Name] is a [brief description]. This audit reviewed [X] contracts
comprising [Y] SLOC deployed on [chain(s)].

### Results Summary

| Severity | Count | Fixed | Acknowledged | Open |
|----------|-------|-------|-------------|------|
| Critical | 0 | 0 | 0 | 0 |
| High | 1 | 1 | 0 | 0 |
| Medium | 3 | 2 | 1 | 0 |
| Low | 5 | 3 | 2 | 0 |
| Informational | 4 | 2 | 2 | 0 |
| **Total** | **13** | **8** | **5** | **0** |

### Overall Assessment

[1-2 paragraph summary of the security posture. Note the most significant
findings and the team's response. Mention code quality, test coverage,
and adherence to best practices.]

---

## 2. Scope & Methodology

### In-Scope Contracts

| Contract | SLOC | Risk Rating |
|----------|------|-------------|
| src/Vault.sol | 245 | High |
| src/Strategy.sol | 189 | Medium |
| src/Oracle.sol | 78 | Medium |
| src/Governance.sol | 156 | Low |
| **Total** | **668** | |

### Out of Scope
- Test files, deployment scripts
- Frontend / offchain infrastructure
- OpenZeppelin library code (v5.0.1)

### Methodology
1. **Recon** (Day 1): Automated analysis (Slither, Aderyn), architecture mapping
2. **Breadth** (Days 2-3): Systematic review of all functions and access controls
3. **Depth** (Days 4-6): Focused analysis on high-risk areas, PoC construction
4. **Verification** (Day 7): Finding verification, severity classification, report

### Tools Used
- Foundry (forge test, forge coverage)
- Slither v0.10.x
- Aderyn v0.x.x
- Manual review

---

## 3. System Overview

### Architecture
[Diagram or text description of contract relationships]

### Key Mechanisms
- **Deposits**: Users deposit USDC, receive vault shares
- **Yield**: Strategy deploys assets to Aave V3
- **Withdrawals**: Users redeem shares for USDC + yield
- **Governance**: Owner (multisig) controls strategy and parameters

### Trust Assumptions
- Owner multisig is honest and competent
- Chainlink oracle provides accurate, timely prices
- Aave V3 operates correctly

---

## 4. Findings
```

## Finding Format

```markdown
### [H-01] Share Inflation via First Depositor Attack

**Severity**: High
**Status**: Fixed (commit def5678)
**Category**: Logic Error

#### Description

The vault does not implement virtual shares or a minimum deposit,
allowing an attacker to inflate the share price and steal from
subsequent depositors.

The attacker deposits 1 wei to receive 1 share, then donates a large
amount directly to the vault. The next depositor's shares are rounded
down to 0, transferring their entire deposit to the attacker.

#### Affected Code

```solidity
// src/Vault.sol, line 45
function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
    shares = assets * totalSupply() / totalAssets(); // rounds to 0 when totalAssets >> assets
    // ...
}
```

#### Impact

Any user depositing after the attacker loses their entire deposit.
Requires the attacker to be the first depositor and front-run the
second deposit.

**Loss**: Up to 100% of the victim's deposit.

#### Proof of Concept

See `test/poc/PoCShareInflation.t.sol`:

```solidity
function test_PoC_firstDepositorShareInflation() public {
    // Attacker deposits 1 wei
    vm.prank(attacker);
    vault.deposit(1, attacker);

    // Attacker donates to inflate price
    vm.prank(attacker);
    token.transfer(address(vault), 1_000_000e6);

    // Victim gets 0 shares
    vm.prank(victim);
    uint256 shares = vault.deposit(999_999e6, victim);
    assertEq(shares, 0); // VULNERABILITY: victim gets nothing
}
```

#### Recommendation

Implement virtual shares and virtual assets offset:

```solidity
uint256 internal constant VIRTUAL_SHARES = 1e3;
uint256 internal constant VIRTUAL_ASSETS = 1;

function convertToShares(uint256 assets) public view returns (uint256) {
    return assets.mulDiv(totalSupply() + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS);
}
```
```

## Risk Summary Table

```markdown
## 5. Risk Summary

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| H-01 | Share inflation via first depositor | High | Fixed |
| M-01 | Oracle staleness check insufficient | Medium | Fixed |
| M-02 | Harvest sandwich attack | Medium | Acknowledged |
| M-03 | Missing withdrawal limit | Medium | Fixed |
| L-01 | Event parameter ordering incorrect | Low | Fixed |
| L-02 | Redundant approval in withdraw | Low | Acknowledged |
| L-03 | Missing zero-address check in constructor | Low | Fixed |
| L-04 | Floating pragma | Low | Fixed |
| L-05 | Centralization risk: owner can change strategy | Low | Acknowledged |
| I-01 | Use custom errors instead of strings | Info | Fixed |
| I-02 | Missing NatSpec on public functions | Info | Acknowledged |
| I-03 | Unused import in Strategy.sol | Info | Fixed |
| I-04 | Consider two-step ownership transfer | Info | Acknowledged |
```

## Recommendations Section

```markdown
## 6. Recommendations

### Short Term (before deployment)
1. Fix all Critical and High findings
2. Add invariant tests for core accounting
3. Implement emergency pause mechanism
4. Add monitoring for health factor degradation

### Medium Term (post-deployment)
1. Add time-delayed oracle fallback
2. Implement withdrawal queuing for large amounts
3. Deploy on testnet with full integration testing

### Long Term
1. Consider formal verification for core math
2. Implement decentralized governance (reduce multisig dependency)
3. Multiple oracle sources for price resilience
```

## Appendices

```markdown
## 7. Appendices

### A. Slither Output (Triaged)
[Filtered Slither results with true/false positive annotations]

### B. Test Coverage
| File | Lines | Branches | Functions |
|------|-------|----------|-----------|
| Vault.sol | 95% | 88% | 100% |
| Strategy.sol | 92% | 85% | 100% |

### C. Gas Report
[forge test --gas-report output for key functions]

### D. Verified Addresses
| Contract | Chain | Address |
|----------|-------|---------|
| Vault | Mainnet | 0x... |
| Strategy | Mainnet | 0x... |
```

## Severity Definitions

Include these definitions in every report:

```markdown
### Severity Definitions

**Critical**: Direct theft of funds, permanent protocol bricking, or
              privilege escalation to admin-level access.

**High**:     Significant loss of funds (>1% TVL), temporary protocol DoS
              lasting >24h, or conditions leading to critical with
              additional steps.

**Medium**:   Moderate fund loss, griefing attacks, temporary DoS,
              value leakage over time, or governance manipulation.

**Low**:      Minor issues, gas inefficiencies, best practice violations
              with edge-case security implications.

**Informational**: Code quality, readability, best practices with no
                   direct security impact.
```

## Checklist

- [ ] Executive summary with results table
- [ ] Scope definition with SLOC counts
- [ ] Methodology section describing audit approach
- [ ] System overview with architecture and trust assumptions
- [ ] Each finding has: severity, status, description, impact, PoC, recommendation
- [ ] Risk summary table with all findings
- [ ] Recommendations section (short/medium/long term)
- [ ] Appendices with tool output and coverage data
- [ ] Severity definitions included
- [ ] Report reviewed for clarity and accuracy before delivery
- [ ] Fix review performed on resolved findings
