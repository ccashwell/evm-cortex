# Audit Report Template

## Structure

```markdown
# Security Audit Report: [Protocol Name]

## 1. Executive Summary
- **Protocol**: [name and brief description]
- **Scope**: [contracts audited, commit hash]
- **Timeline**: [start date - end date]
- **Auditors**: [names/team]
- **Methodology**: [tools used, approach]
- **Findings Summary**:
  | Severity | Count |
  |----------|-------|
  | Critical | X |
  | High     | X |
  | Medium   | X |
  | Low      | X |
  | Info     | X |

## 2. Scope
### Files in Scope
| File | SLOC | Description |
|------|------|-------------|
| src/Vault.sol | 250 | Core vault logic |

### Out of Scope
- Third-party libraries (OpenZeppelin, Solmate)
- Test and script files
- Frontend code

## 3. Methodology
- Manual code review
- Automated analysis (Slither, Aderyn)
- Foundry fuzz testing
- Invariant testing
- Fork testing against mainnet state

## 4. System Overview
[Architecture diagram, key contracts, trust model, external dependencies]

## 5. Findings
[Each finding in standard finding-output-format]

## 6. Recommendations
[Prioritized list of improvements beyond specific findings]

## 7. Appendix
### A. Static Analysis Output
### B. Gas Report
### C. Test Coverage
### D. Invariant Test Results
```

## Writing Guidelines
- Be precise: reference specific lines, not general areas
- Be actionable: every finding must have a clear recommendation
- Be honest: if impact is unclear, say so
- Quantify impact where possible: "attacker can steal X tokens"
- Include PoC for Critical and High findings (mandatory)
