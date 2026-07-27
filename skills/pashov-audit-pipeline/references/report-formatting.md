# Report Formatting

## Report Path

Save the report to `{project-name}-pashov-ai-audit-report-{timestamp}.md` in the current working directory, where `{project-name}` is the repo root basename and `{timestamp}` is `YYYYMMDD-HHMMSS` at scan time.

## EVM Cortex deviations from upstream

Two changes, both required by the repo's global finding-output-format rules. They are already folded into the template below — this section only explains *why* it differs from upstream's.

1. **Findings carry a severity as well as a confidence.** Upstream orders findings by confidence alone. Here, findings are grouped into severity bands (Critical → High → Medium → Low → Informational) and ordered by confidence descending *within* each band, numbered per band (`C-01`, `H-01`, `M-01`, `L-01`, `I-01`). See `judging.md` for how severity is assigned and why it is independent of confidence.
2. **Critical and High findings include a Proof of Concept block** referencing the Foundry test that demonstrates the exploit. A Critical or High finding with no PoC is not ready to report.

Unchanged from upstream: the scope table, the description-then-fix shape, the sub-threshold rule (findings below confidence 80 get a description but no **Fix** block), the leads section, and the disclaimer.

## Output Format

````
# 🔐 Security Review — <ContractName or repo name>

---

## Scope

|                                  |                                                        |
| -------------------------------- | ------------------------------------------------------ |
| **Mode**                         | ALL / default / filename                               |
| **Files reviewed**               | `File1.sol` · `File2.sol`<br>`File3.sol` · `File4.sol` | <!-- list every file, 3 per line -->
| **nSLOC**                        | N                                                      |
| **Commit**                       | <hash>                                                 |
| **Methodology**                  | Pashov 12-agent parallel audit (solidity-auditor v3)   |
| **Confidence threshold (1-100)** | N                                                      |

| Severity | Count |
|----------|-------|
| Critical | X |
| High | Y |
| Medium | Z |
| Low | W |
| Informational | V |

### Key Observations

- <the most important findings, in 1-3 sentences>
- <overall assessment of code quality and security posture>

---

## Critical Findings

### [C-01] <Title>

**Severity:** Critical · **Confidence:** 95 · **Agents:** [3]
`ContractName.functionName` · `src/Contract.sol:L42-L58`
**Status:** Confirmed

**Description**
<The vulnerable code pattern and why it is exploitable, in 1 short sentence>

**Impact**
<What an attacker gains, quantified>

**Proof of Concept**
<Foundry test reference plus the traced exploit path — mandatory for Critical/High>

**Fix**

```diff
- vulnerable line(s)
+ fixed line(s)
```

---

< ... remaining Critical findings, confidence descending >

## High Findings

### [H-01] <Title>

**Severity:** High · **Confidence:** 82 · **Agents:** [2]
`ContractName.functionName` · `src/Contract.sol:L88-L94`
**Status:** Confirmed

**Description**
<...>

**Impact**
<...>

**Proof of Concept**
<mandatory for High>

**Fix**

```diff
- vulnerable line(s)
+ fixed line(s)
```

---

## Medium Findings

### [M-01] <Title>

**Severity:** Medium · **Confidence:** 75
`ContractName.functionName` · `src/Contract.sol:L120`

**Description**
<...>

<!-- confidence < 80: description only, no Fix block -->

---

## Low Findings

### [L-01] <Title>
<...>

## Informational

### [I-01] <Title>
<...>

---

Findings List

| # | Severity | Confidence | Title |
|---|---|---|---|
| C-01 | Critical | [95] | <title> |
| H-01 | High | [82] | <title> |
| M-01 | Medium | [75] | <title> |

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass. These are not false positives — they are high-signal leads for manual review. Not scored._

- **<Title>** — `Contract.function` — Code smells: <missing guard, unsafe arithmetic, etc.> — <1-2 sentence description of the trail and what remains unverified>
- **<Title>** — `Contract.function` — Code smells: <...> — <1-2 sentence description>

---

## Appendix

### A. Scope Table
### B. Methodology — 12-agent parallel audit with deduplication, four-gate judging, and PoC verification
### C. Tools — Foundry, Slither, Aderyn, manual review by 12 specialized agents
### D. Agent Attribution

| Finding | Agents That Flagged |
|---------|---------------------|
| C-01 | Math & Precision, Numerical Gap, Execution Trace |
| H-01 | Access Control, Trust Gap |

---

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and onchain monitoring are strongly recommended. For a consultation regarding your projects' security, visit [https://www.pashov.com](https://www.pashov.com)

````

**Rules:** Follow the template above exactly. Group findings into severity bands, then sort by confidence (highest first) within each band. Findings below the confidence threshold get a description but no **Fix** block. Critical and High findings must carry a Proof of Concept. Draft findings directly in report format — do not re-generate.
