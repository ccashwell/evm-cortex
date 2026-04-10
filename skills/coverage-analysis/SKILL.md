---
name: coverage-analysis
description: Use when measuring test coverage for Solidity contracts, identifying untested code paths, or establishing coverage requirements. Covers forge coverage, lcov output, visualization, and coverage-driven testing.
---

# Test Coverage Analysis

## Running Coverage

```bash
# Basic coverage report
forge coverage

# Output:
# | File               | % Lines         | % Statements    | % Branches      | % Functions     |
# |--------------------|-----------------|-----------------|-----------------|-----------------|
# | src/Vault.sol      | 92.31% (36/39)  | 89.47% (34/38)  | 75.00% (12/16)  | 100.00% (8/8)  |
# | src/Token.sol      | 100.00% (12/12) | 100.00% (10/10) | 100.00% (4/4)   | 100.00% (3/3)  |
```

## LCOV Output for Visualization

```bash
# Generate lcov.info
forge coverage --report lcov

# View in VS Code with "Coverage Gutters" extension
# Or generate HTML report:
genhtml lcov.info -o coverage-report --branch-coverage
open coverage-report/index.html
```

## Coverage Types

| Type | Meaning | Priority |
|------|---------|----------|
| **Line** | Was this line executed? | Medium |
| **Statement** | Was this statement executed? | Medium |
| **Branch** | Were both sides of if/else taken? | **High** |
| **Function** | Was this function called? | Low |

Branch coverage is the most important for security — untested branches are where bugs hide.

## Filtering Coverage

```bash
# Exclude test files and scripts
forge coverage --report lcov

# Filter the lcov output
lcov --remove lcov.info 'test/*' 'script/*' 'node_modules/*' \
     --output-file lcov-filtered.info
```

## Coverage-Driven Testing Workflow

### 1. Identify Gaps

```bash
# Generate and inspect coverage
forge coverage --report lcov
genhtml lcov.info -o coverage-report --branch-coverage
```

### 2. Focus on Uncovered Branches

For each uncovered branch, write a targeted test:

```solidity
// If coverage shows this branch is untested:
//   if (amount > maxDeposit) revert ExceedsMax();

function test_depositExceedsMax() public {
    uint256 maxDeposit = vault.maxDeposit(address(this));
    vm.expectRevert(abi.encodeWithSelector(ExceedsMax.selector));
    vault.deposit(maxDeposit + 1, address(this));
}
```

### 3. Common Untested Paths

```solidity
// Zero-amount edge cases
function test_depositZero() public {
    vm.expectRevert("zero amount");
    vault.deposit(0, address(this));
}

// Reentrancy guard activation
function test_reentrancyBlocked() public {
    attacker.setReentrancy(true);
    vm.expectRevert("ReentrancyGuard: reentrant call");
    attacker.attack();
}

// Overflow/underflow (checked math reverts)
function test_overflowReverts() public {
    vm.expectRevert();
    vault.deposit(type(uint256).max, address(this));
}

// Access control all roles
function test_onlyOwnerFunctions() public {
    vm.prank(nonOwner);
    vm.expectRevert();
    vault.setFee(100);
}

// Pause/unpause paths
function test_pausedDeposit() public {
    vault.pause();
    vm.expectRevert("Pausable: paused");
    vault.deposit(1 ether, address(this));
}
```

## CI Integration

```yaml
- name: Check coverage threshold
  run: |
    forge coverage --report summary | tee coverage.txt
    
    # Parse line coverage percentage
    COVERAGE=$(grep "| Total" coverage.txt | awk '{print $4}' | tr -d '%')
    
    if (( $(echo "$COVERAGE < 85" | bc -l) )); then
      echo "Coverage $COVERAGE% is below 85% threshold"
      exit 1
    fi
```

## Coverage Report in `foundry.toml`

```toml
[profile.default]
# Exclude from coverage analysis
no_match_coverage = "test|script|mock"
```

## Coverage Targets by Component

| Component | Minimum | Target |
|-----------|---------|--------|
| Core protocol logic | 95% branch | 100% branch |
| Token contracts | 90% branch | 100% branch |
| Admin/governance | 85% branch | 95% branch |
| Periphery/helpers | 80% branch | 90% branch |
| View functions | 70% line | 85% line |

## Limitations

- Coverage does not measure test quality — 100% coverage doesn't mean 100% correct
- Foundry coverage doesn't handle inline assembly well
- Branch coverage inside `require()` chains may not report correctly
- Coverage overhead slows test execution (separate coverage CI step)
- Unreachable code (dead branches) inflates uncovered percentage

## Checklist

- [ ] `forge coverage` runs in CI on every PR
- [ ] LCOV report generated for visual inspection
- [ ] Branch coverage prioritized over line coverage
- [ ] Coverage threshold enforced (85%+ for core contracts)
- [ ] Test and script files excluded from coverage stats
- [ ] Uncovered branches documented as known gaps or addressed
- [ ] Coverage report reviewed during audit preparation
- [ ] New features include tests that maintain/improve coverage
