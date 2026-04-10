# PoC Execution Rules

## Requirements
- Critical and High severity findings MUST have a working PoC
- PoCs are written as Foundry tests
- PoCs must demonstrate actual impact (e.g., stolen funds), not just theoretical possibility
- PoCs must be reproducible: pin block number for fork tests

## PoC Template
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {IPool} from "../src/interfaces/IPool.sol";

contract ExploitTest is Test {
    // Target contracts
    IPool pool;
    address attacker = makeAddr("attacker");
    address victim = makeAddr("victim");

    function setUp() public {
        // Fork mainnet at specific block
        vm.createSelectFork(vm.envString("ETH_RPC_URL"), 19_000_000);

        // Setup: give victim funds, approve, deposit
        pool = IPool(0x...);
        deal(address(token), victim, 100e18);
        vm.prank(victim);
        token.approve(address(pool), type(uint256).max);
        vm.prank(victim);
        pool.deposit(100e18);
    }

    function test_ExploitDescription() public {
        uint256 victimBalanceBefore = token.balanceOf(victim);

        // Step 1: Attacker prepares
        vm.startPrank(attacker);

        // Step 2: Execute attack
        // ... exploit steps ...

        // Step 3: Verify impact
        vm.stopPrank();
        uint256 attackerProfit = token.balanceOf(attacker);
        uint256 victimLoss = victimBalanceBefore - token.balanceOf(victim);

        assertGt(attackerProfit, 0, "Attacker should profit");
        console.log("Attacker profit:", attackerProfit);
        console.log("Victim loss:", victimLoss);
    }
}
```

## Rules
1. Pin fork block number for reproducibility
2. Use `makeAddr()` for named test addresses
3. Use `deal()` to set up token balances
4. Log actual impact amounts with `console.log`
5. Assert the exploit succeeds (assertGt for profit)
6. Comment each step of the attack clearly
7. Keep PoC minimal: shortest path to demonstrate the bug

## Running PoC
```bash
forge test --match-test test_Exploit -vvvv --fork-url $ETH_RPC_URL
```
