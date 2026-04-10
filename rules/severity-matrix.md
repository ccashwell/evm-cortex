# Severity Matrix

## Classification: Impact x Likelihood

|              | Certain      | Likely       | Possible     | Unlikely     |
|--------------|-------------|-------------|-------------|-------------|
| **Critical** | Critical    | Critical    | High        | Medium      |
| **High**     | Critical    | High        | High        | Medium      |
| **Medium**   | High        | Medium      | Medium      | Low         |
| **Low**      | Medium      | Low         | Low         | Informational |

## Impact Definitions

### Critical Impact
- Direct theft of user funds
- Permanent freezing of funds (>$100K)
- Protocol insolvency
- Governance takeover

### High Impact
- Significant loss of funds (partial)
- Temporary freezing of funds
- Unauthorized minting/burning of tokens
- Bypass of critical access controls

### Medium Impact
- Limited fund loss (griefing, dust amounts)
- Denial of service to specific functions
- Incorrect accounting that doesn't lead to fund loss
- Centralization risks with admin keys

### Low Impact
- Gas inefficiency
- Missing events
- Non-critical deviations from spec
- Code quality issues

## Likelihood Definitions
- **Certain**: Will happen under normal operation
- **Likely**: Exploitable with minimal effort/cost
- **Possible**: Requires specific conditions or moderate effort
- **Unlikely**: Requires significant effort, cost, or rare conditions

## Finding Format
```
## [SEVERITY] Finding Title

**Impact**: [Critical/High/Medium/Low]
**Likelihood**: [Certain/Likely/Possible/Unlikely]

**Description**: What the vulnerability is
**Location**: File:line
**Impact**: What happens if exploited
**PoC**: Reference to proof-of-concept test
**Recommendation**: How to fix
```
