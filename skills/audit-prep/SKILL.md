---
name: audit-prep
description: Use when preparing a codebase for security audit. Covers scope definition, documentation review, dependency analysis, invariant documentation, known issues lists, prior audit review, test coverage verification, and static analysis.
---

# Pre-Audit Preparation

## Overview

Audit preparation maximizes audit value. A well-prepared codebase lets auditors focus on finding real vulnerabilities instead of deciphering intent or fighting build issues.

## Audit Preparation Checklist

### 1. Scope Definition

```markdown
## Audit Scope

### In Scope
| File | SLOC | Description |
|------|------|-------------|
| src/Vault.sol | 245 | Core vault logic, deposits/withdrawals |
| src/Strategy.sol | 189 | Yield strategy integration |
| src/Oracle.sol | 78 | Price feed wrapper |
| **Total** | **512** | |

### Out of Scope
- OpenZeppelin imports (v5.0.1) — audited separately
- Test files and deployment scripts
- Frontend / offchain components

### Deployment Chain(s)
- Ethereum Mainnet
- Arbitrum One

### EVM Version
- Shanghai (solc 0.8.24)
```

### 2. Architecture Documentation

Provide auditors with:

```markdown
## Architecture

### Contract Relationships
Vault -> Strategy -> ExternalProtocol (Aave V3)
Vault -> Oracle -> Chainlink ETH/USD Feed
Governor -> Timelock -> Vault (parameter changes)

### Access Control
- Owner (2/3 multisig): pause, setFee, setStrategy
- Keeper (EOA): harvest, rebalance
- Users: deposit, withdraw, claim

### External Dependencies
| Dependency | Address | Trust Assumption |
|-----------|---------|-----------------|
| Aave V3 Pool | 0x8787... | Fully trusted |
| Chainlink ETH/USD | 0x5f4e... | Staleness checked |
| USDC | 0xA0b8... | Standard ERC20 |

### Value Flow
1. User deposits USDC -> Vault mints shares
2. Vault deploys USDC to Aave via Strategy
3. Strategy harvests yield -> increases share price
4. User redeems shares -> receives USDC + yield
```

### 3. Invariants Documentation

```markdown
## Protocol Invariants

### Core Invariants (must NEVER be violated)
1. `vault.totalAssets() >= vault.totalSupply() * minSharePrice`
   - Shares are always redeemable for at least their initial value
2. `sum(userShares) == vault.totalSupply()`
   - No share inflation/deflation outside deposit/withdraw
3. `strategy.totalDeployed() + vault.idleAssets() == vault.totalAssets()`
   - All assets accounted for

### Economic Invariants
4. Share price monotonically increases (no value extraction)
5. Withdrawal amount <= deposit amount + accumulated yield
6. Fees never exceed configured maximum (10%)

### Access Control Invariants
7. Only owner can change strategy/oracle/fees
8. Only keeper can trigger harvest
9. Users can always withdraw (no permanent lock, even if paused)
```

### 4. Known Issues / Design Decisions

```markdown
## Known Issues & Accepted Risks

### K-01: First depositor receives favorable exchange rate
- **Severity**: Low
- **Mitigation**: Virtual shares offset (1e3) prevents manipulation
- **Status**: Accepted with mitigation

### K-02: Oracle can return stale prices during Chainlink outage
- **Severity**: Medium
- **Mitigation**: 1-hour staleness check; fallback oracle planned for v2
- **Status**: Accepted for v1

### Design Decisions
- D-01: Emergency withdraw bypasses strategy — users get idle assets only
- D-02: Fee-on-transfer tokens NOT supported (by design)
- D-03: Rebasing tokens NOT supported (by design)
```

### 5. Prior Audit Review

If previously audited:
- Link to prior audit report
- List resolved vs unresolved findings
- Describe changes since last audit
- Highlight new code vs unchanged code

### 6. Test Coverage Verification

```bash
# Run full test suite
forge test -vvv

# Generate coverage report
forge coverage --report lcov
genhtml lcov.info -o coverage-report

# Verify coverage thresholds
# Core logic: > 95% branch coverage
# Periphery: > 85% branch coverage
```

### 7. Static Analysis

```bash
# Slither
slither . --filter-paths "test|script|node_modules" \
         --exclude naming-convention,solc-version

# Aderyn
aderyn . --exclude test/ script/

# Review and triage findings
# - Fix genuine issues before audit
# - Document accepted findings with rationale
```

### 8. Build Verification

```bash
# Clean build
forge clean && forge build

# Verify all tests pass
forge test

# Check for compiler warnings
forge build 2>&1 | grep -i warning

# Verify contract sizes
forge build --sizes
```

## Deliverables to Auditors

```
project/
├── src/                     # Source contracts (in scope)
├── test/                    # Full test suite
├── docs/
│   ├── ARCHITECTURE.md      # System design
│   ├── INVARIANTS.md        # Protocol invariants
│   ├── KNOWN_ISSUES.md      # Accepted risks
│   └── DEPLOYMENT.md        # Deployment plan and addresses
├── audit/
│   ├── scope.md             # Scope definition
│   ├── prior-audits/        # Previous audit reports
│   └── slither-output.json  # Static analysis results
├── foundry.toml
└── README.md                # Build and test instructions
```

## Checklist

- [ ] Scope document with SLOC counts and file descriptions
- [ ] Architecture diagram with contract relationships
- [ ] External dependency list with addresses and trust assumptions
- [ ] Protocol invariants documented and tested
- [ ] Known issues list with severity and mitigation
- [ ] Test suite passes with 90%+ branch coverage on in-scope code
- [ ] Slither/Aderyn run with findings triaged
- [ ] Clean build with no warnings
- [ ] README with build, test, and deployment instructions
- [ ] Git commit hash pinned for audit scope
