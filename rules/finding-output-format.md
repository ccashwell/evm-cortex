# Finding Output Format

## Standard Finding Structure

Every vulnerability finding MUST use this format:

```markdown
## [SEVERITY] Title — Concise Description

**Severity**: Critical / High / Medium / Low / Informational
**Type**: Reentrancy / Access Control / Math / Oracle / Logic / DoS / MEV
**Location**: `src/Contract.sol:L42-L58`
**Status**: Confirmed / Disputed / Fixed / Acknowledged

### Description
Clear explanation of the vulnerability. What is wrong and why.

### Impact
What happens if this is exploited. Quantify where possible (e.g., "attacker can drain the entire pool balance").

### Root Cause
The specific code pattern or logic error that enables the vulnerability.

### Proof of Concept
```solidity
function test_Exploit() public {
    // Step-by-step exploit
}
```

### Recommendation
Specific code change to fix the issue. Prefer showing the fix:
```solidity
// Before (vulnerable)
token.transfer(msg.sender, amount);
balances[msg.sender] -= amount;

// After (fixed)
balances[msg.sender] -= amount;
token.transfer(msg.sender, amount);
```
```

## Severity Rules
- Critical/High MUST have a working PoC in Foundry
- Medium SHOULD have a PoC or clear step-by-step reproduction
- Low/Informational need clear description only
- Every finding must reference specific file and line numbers

## Evidence Requirements by Severity
| Severity | PoC Required | Impact Quantified | Fix Provided |
|----------|-------------|-------------------|-------------|
| Critical | Yes (mandatory) | Yes ($ amount) | Yes |
| High | Yes (mandatory) | Yes | Yes |
| Medium | Recommended | Described | Yes |
| Low | No | Described | Recommended |
| Info | No | No | Optional |
