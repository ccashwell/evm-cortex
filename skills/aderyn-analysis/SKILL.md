---
name: aderyn-analysis
description: Use when running Aderyn (by Cyfrin) static analysis on Solidity contracts. Covers installation, running analysis, detectors, report output, comparison with Slither, and CI integration.
---

# Aderyn Static Analysis (Cyfrin)

## Overview

Aderyn is a Rust-based Solidity static analyzer by Cyfrin. Fast compilation, Foundry-native, and produces markdown reports. Complements Slither with different detection heuristics.

## Installation

```bash
# Via cargo (recommended)
cargo install aderyn

# Via curl
curl -L https://raw.githubusercontent.com/Cyfrin/aderyn/dev/cyfrinup/install | bash
cyfrinup

# Verify
aderyn --version
```

## Running Aderyn

```bash
# Analyze entire project
aderyn .

# Output to specific file
aderyn . --output report.md

# JSON output
aderyn . --output report.json

# Target specific scope
aderyn . --src src/

# Exclude paths
aderyn . --exclude lib/ --exclude test/

# Specific root for Foundry project
aderyn --root /path/to/project
```

## Report Output

Aderyn generates a structured markdown report:

```markdown
# Aderyn Analysis Report

## Summary
| Key | Value |
|-----|-------|
| Solidity Files | 12 |
| Total Issues | 24 |
| High Issues | 2 |
| Medium Issues | 5 |
| Low Issues | 10 |
| NC Issues | 7 |

## High Issues

### H-1: Unprotected initializer
**Severity**: High
**File**: src/Vault.sol:45
**Description**: ...

## Medium Issues
...
```

## Key Detectors

### High Severity

| Detector | What it finds |
|----------|--------------|
| `unprotected-initializer` | Missing initializer modifier |
| `delegatecall-in-loop` | Delegatecall inside loops |
| `arbitrary-transfer-from` | Uncontrolled transferFrom |
| `selfdestruct-usage` | selfdestruct in code |
| `uninitialized-state-variable` | State vars without default |
| `weak-randomness` | Using block.timestamp/prevrandao for randomness |

### Medium Severity

| Detector | What it finds |
|----------|--------------|
| `centralization-risk` | Single owner/admin controls |
| `solmate-safe-transfer` | Missing return check on transfer |
| `unchecked-return` | Ignored return values |
| `reentrancy` | Potential reentrancy |
| `push-0-opcode` | PUSH0 usage (breaks on some L2s) |
| `tx-origin-auth` | tx.origin for authorization |

### Low Severity

| Detector | What it finds |
|----------|--------------|
| `missing-zero-address-check` | No address(0) validation |
| `unsafe-oz-access-control` | Risky OZ access patterns |
| `public-variable-read-in-external` | Gas: public var in external fn |
| `unused-import` | Imported but unused |
| `unused-state-variable` | Declared but unused state |
| `empty-block` | Empty function body |
| `large-literal` | Magic numbers without constants |

## Comparison: Aderyn vs Slither

| Feature | Aderyn | Slither |
|---------|--------|---------|
| Language | Rust | Python |
| Speed | Very fast | Moderate |
| Foundry integration | Native | Via adapter |
| Output format | Markdown / JSON | Text / JSON / SARIF |
| Detector count | ~40 | ~90+ |
| Custom detectors | Planned | Supported |
| Upgradeability check | Basic | Full (slither-check-upgradeability) |
| Install | cargo / cyfrinup | pip |

**Recommendation**: Run both. Aderyn catches different patterns than Slither, and the overlap ensures coverage.

## CI Integration

### GitHub Actions

```yaml
name: Aderyn Analysis
on: [push, pull_request]

jobs:
  aderyn:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1

      - name: Build
        run: forge build

      - name: Install Aderyn
        run: cargo install aderyn

      - name: Run Aderyn
        run: aderyn . --output aderyn-report.md

      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: aderyn-report
          path: aderyn-report.md

      - name: Check for High Issues
        run: |
          if grep -q "High Issues | [1-9]" aderyn-report.md; then
            echo "::error::Aderyn found high-severity issues"
            exit 1
          fi
```

## Workflow: Combined Analysis

```bash
#!/bin/bash
# Run both analyzers for maximum coverage

echo "=== Building ==="
forge build

echo "=== Aderyn Analysis ==="
aderyn . --output aderyn-report.md
echo "Report: aderyn-report.md"

echo "=== Slither Analysis ==="
slither . --json slither-report.json \
  --filter-paths "lib/|test/|script/" \
  --exclude naming-convention,pragma
echo "Report: slither-report.json"

echo "=== Summary ==="
echo "Aderyn:"
head -20 aderyn-report.md
echo ""
echo "Slither findings:"
python3 -c "
import json
with open('slither-report.json') as f:
    data = json.load(f)
    results = data.get('results', {}).get('detectors', [])
    by_impact = {}
    for r in results:
        impact = r.get('impact', 'unknown')
        by_impact[impact] = by_impact.get(impact, 0) + 1
    for k, v in sorted(by_impact.items()):
        print(f'  {k}: {v}')
"
```

## Triage Process

1. Run `aderyn . --output report.md`
2. Open `report.md` and review High → Medium → Low
3. For each finding:
   - True positive → create fix task
   - False positive → document reasoning
   - Informational → log for code review
4. Re-run after fixes to confirm resolution
5. Archive final report with the audit

## Configuration

Aderyn reads `aderyn.toml` if present:

```toml
[profile.default]
src = "src"
exclude = ["lib/", "test/", "script/"]
```

## Key Differences from Slither

- Aderyn's `centralization-risk` detector flags admin/owner patterns more aggressively
- Aderyn specifically checks for PUSH0 opcode compatibility (important for L2 deploys)
- Slither has deeper taint analysis and data flow tracking
- Aderyn's markdown output is more audit-report-ready
- Slither has upgradeability-specific tooling (`slither-check-upgradeability`)
