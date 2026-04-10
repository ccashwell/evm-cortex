# Foundry-First Workflow

## Development Cycle
1. Write interface / spec
2. Write tests first (TDD)
3. Run tests — expect RED
4. Implement contract
5. Run tests — expect GREEN
6. Run `forge snapshot` to baseline gas
7. Optimize if needed
8. Run `slither .` for static analysis
9. Run `forge coverage` to verify coverage
10. Deploy with `forge script`

## Test Naming Convention
```
test_FunctionName_Condition_ExpectedResult
test_RevertWhen_Condition
testFuzz_FunctionName_WithRandomInputs
invariant_PropertyDescription
```

## Test Structure
```solidity
function test_Deposit_WithValidAmount_MintsShares() public {
    // Arrange
    uint256 amount = 1 ether;
    deal(address(token), alice, amount);

    // Act
    vm.prank(alice);
    uint256 shares = vault.deposit(amount);

    // Assert
    assertGt(shares, 0);
    assertEq(vault.balanceOf(alice), shares);
}
```

## Essential Commands
```bash
forge build              # Compile
forge test               # Run all tests
forge test -vvvv         # With full trace
forge test --match-test test_Deposit  # Run specific test
forge test --gas-report  # With gas report
forge snapshot           # Save gas snapshot
forge snapshot --check   # Compare against snapshot
forge coverage           # Test coverage
forge inspect Contract storage-layout  # Storage layout
slither .                # Static analysis
```

## Before Every PR
- [ ] `forge build` — clean compilation
- [ ] `forge test` — all tests pass
- [ ] `forge snapshot --check` — no gas regressions
- [ ] `slither .` — no high/medium findings
- [ ] `forge coverage` — adequate coverage on new code

## Cheatcode Reference (Most Used)
- `vm.prank(addr)` — next call from addr
- `vm.startPrank(addr)` — all calls from addr until stopPrank
- `vm.deal(addr, amount)` — set ETH balance
- `deal(token, addr, amount)` — set ERC-20 balance
- `vm.warp(timestamp)` — set block.timestamp
- `vm.roll(blockNumber)` — set block.number
- `vm.expectRevert(Error.selector)` — expect revert
- `vm.expectEmit(true, true, false, true)` — expect event
- `vm.assume(condition)` — skip fuzz input if false
- `vm.bound(x, min, max)` — constrain fuzz input
