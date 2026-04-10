---
name: foundry-testing
description: Use when writing Solidity tests with Foundry/Forge. Covers cheatcodes, assertions, fork testing, gas reporting, event testing, and test organization patterns.
---

# Foundry Testing Patterns

## Test File Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {MyContract} from "../src/MyContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MyContractTest is Test {
    MyContract public target;
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public deployer = makeAddr("deployer");

    function setUp() public {
        vm.startPrank(deployer);
        target = new MyContract();
        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function test_basicOperation() public {
        vm.prank(alice);
        target.doSomething(42);
        assertEq(target.value(), 42);
    }

    function test_revertOnUnauthorized() public {
        vm.prank(bob);
        vm.expectRevert("unauthorized");
        target.adminFunction();
    }
}
```

## Essential Cheatcodes

### Identity & Balance

```solidity
// Set msg.sender for next call
vm.prank(alice);

// Set msg.sender for all subsequent calls until stopPrank()
vm.startPrank(alice);
// ... multiple calls as alice
vm.stopPrank();

// Set ETH balance
vm.deal(alice, 100 ether);

// Set ERC20 balance (writes to storage slot)
deal(address(usdc), alice, 1_000_000e6);

// Create labeled address
address alice = makeAddr("alice");

// Create address with private key
(address signer, uint256 pk) = makeAddrAndKey("signer");
```

### Time & Block Manipulation

```solidity
// Set block.timestamp
vm.warp(1700000000);

// Set block.number
vm.roll(18_000_000);

// Skip forward in time
skip(1 days);

// Rewind time
rewind(1 hours);
```

### Revert Expectations

```solidity
// Expect next call to revert with message
vm.expectRevert("insufficient balance");
target.withdraw(1000);

// Expect revert with custom error
vm.expectRevert(abi.encodeWithSelector(InsufficientBalance.selector, 1000, 500));
target.withdraw(1000);

// Expect revert with no message check
vm.expectRevert();
target.failingFunction();
```

### Event Expectations

```solidity
// expectEmit(checkTopic1, checkTopic2, checkTopic3, checkData)
vm.expectEmit(true, true, false, true);
emit Transfer(alice, bob, 100);
token.transfer(bob, 100);

// Alternative: expectEmit on specific emitter
vm.expectEmit(address(token));
emit Transfer(alice, bob, 100);
token.transfer(bob, 100);
```

### Storage Manipulation

```solidity
// Read storage slot
bytes32 value = vm.load(address(target), bytes32(uint256(0)));

// Write storage slot
vm.store(address(target), bytes32(uint256(0)), bytes32(uint256(42)));

// Record storage accesses
vm.record();
target.doSomething();
(bytes32[] memory reads, bytes32[] memory writes) = vm.accesses(address(target));
```

### Snapshots

```solidity
// Save state
uint256 snapshot = vm.snapshotState();

// Do some operations
target.modifyState();

// Revert to snapshot
vm.revertToState(snapshot);
```

## Fork Testing

```solidity
function setUp() public {
    // Fork mainnet at latest block
    uint256 forkId = vm.createFork("mainnet");
    vm.selectFork(forkId);

    // Or fork at specific block
    uint256 pinnedFork = vm.createFork("mainnet", 19_000_000);
}

function test_withFork() public {
    // Interact with real deployed contracts
    IERC20 usdc = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    uint256 balance = usdc.balanceOf(0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503); // Binance
    assertGt(balance, 0);
}
```

## Gas Reporting

```solidity
// Label addresses for gas reports
vm.label(address(target), "MyContract");
vm.label(address(token), "USDC");

// Measure gas manually
uint256 gasBefore = gasleft();
target.expensiveOperation();
uint256 gasUsed = gasBefore - gasleft();
console2.log("Gas used:", gasUsed);
```

Run with: `forge test --gas-report`

## Test Organization

```
test/
├── unit/
│   ├── MyContract.t.sol           # Unit tests
│   └── MyToken.t.sol
├── integration/
│   ├── AaveIntegration.t.sol      # Protocol integration
│   └── UniswapSwap.t.sol
├── invariant/
│   ├── handlers/Handler.sol       # Invariant handlers
│   └── MyContract.invariant.t.sol
├── fork/
│   └── MainnetFork.t.sol          # Fork tests
└── helpers/
    ├── BaseTest.sol               # Shared setUp
    └── Tokens.sol                 # Token deployment helpers
```

## Common Patterns

```solidity
// Bound fuzz inputs to valid range
function testFuzz_deposit(uint256 amount) public {
    amount = bound(amount, 1e18, 1_000_000e18);
    // ...
}

// Test with multiple actors
function test_multipleUsers() public {
    for (uint256 i = 0; i < 10; i++) {
        address user = makeAddr(string.concat("user", vm.toString(i)));
        vm.deal(user, 1 ether);
        vm.prank(user);
        target.deposit{value: 1 ether}();
    }
}

// Expect multiple events in sequence
vm.expectEmit(true, true, false, true);
emit Deposit(alice, 100);
vm.expectEmit(true, true, false, true);
emit BalanceUpdated(alice, 100);
target.deposit(100);
```

## Checklist

- [ ] `setUp()` creates clean state for each test
- [ ] Use `makeAddr()` for labeled test addresses
- [ ] Use `vm.expectRevert()` to test failure paths
- [ ] Use `vm.expectEmit()` to verify events
- [ ] Fork tests pinned to specific block numbers for reproducibility
- [ ] Gas report generated for critical functions
- [ ] Fuzz tests use `bound()` to constrain inputs
- [ ] Labels applied to addresses for readable traces
