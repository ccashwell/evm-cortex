# Upgrading EVM Cortex

Guide for upgrading between EVM Cortex versions.

## Quick Upgrade

```bash
cd evm-cortex
git pull origin main
./install.sh
```

## File Categories

### Safe to Overwrite

These files are maintained by EVM Cortex and should be overwritten during upgrades:

| Path | Content |
|------|---------|
| `agents/*.md` | Agent definitions |
| `skills/*/SKILL.md` | Skill definitions |
| `hooks/src/*.ts` | Hook source code |
| `hooks/dist/*.mjs` | Compiled hooks |
| `rules/*.md` | Rule files |
| `.cursor/rules/*.mdc` | Cursor IDE rules |
| `install.sh` | Installer script |

### Merge Carefully

These files may contain user customizations:

| Path | Notes |
|------|-------|
| `~/.claude/settings.json` | User hook configuration, permissions |
| `CLAUDE.md` | May have project-specific additions to routing table |

### Never Overwrite

These are user data:

| Path | Content |
|------|---------|
| `~/.claude/projects/` | Project-specific memory |
| `~/.claude/memory/` | Auto-memory files |
| Custom agents/skills | Any user-created agents or skills |

## Version History

### v1.0.0 (2026-04-10)

**Initial release as EVM Cortex** — Ethereum protocol engineering squad.

**Agents (50):**

| Squad | Count | Highlights |
|-------|-------|-----------|
| Core Protocol Development | 6 | solidity-architect, solidity-engineer, gas-optimizer, contract-deployer, storage-layout-analyst, protocol-designer |
| Security Squad | 10 | audit-orchestrator, depth-state-trace, depth-token-flow, depth-edge-case, depth-external, security-verifier, invariant-analyst, access-control-reviewer, oracle-analyst, mev-analyst |
| Testing Squad | 5 | foundry-tester, invariant-tester, formal-verifier, fuzzer, poc-writer |
| DeFi Specialists | 7 | defi-architect, amm-expert, lending-expert, oracle-expert, bridge-expert, tokenomics-analyst, yield-strategist |
| Uniswap Specialists | 5 | uniswap-v4-expert, uniswap-v3-expert, uniswap-math-expert, lp-analyst, pool-finder |
| Tooling & Infrastructure | 6 | foundry-expert, openzeppelin-expert, slither-analyst, subgraph-builder, dapp-frontend, devops-chain |
| Standards & Governance | 5 | eip-expert, erc-implementer, upgrade-planner, governance-designer, l2-specialist |
| Cross-Cutting | 6 | planner, code-reviewer, scout, sleuth, scribe, verifier |

**Skills (86):** Covering Solidity patterns, security, DeFi, Uniswap V3/V4, testing, auditing, token standards, tooling, and deployment.

**Hooks (18):** Including 5 EVM-specific hooks:
- `forge-compile-check` — Runs `forge build` on `.sol` edits
- `slither-on-save` — Runs Slither static analysis on `.sol` edits
- `gas-snapshot-diff` — Warns on gas regressions after `.sol` edits
- `natspec-enforcer` — Checks for missing NatSpec on public/external functions
- `storage-layout-check` — Validates storage layout for upgradeable contracts

**Rules (15):** EVM-specific development guidelines covering style, security, testing, gas, auditing, decimals, conventions, upgrades, deployment, and reporting.

**CLAUDE.md orchestrator:** Agent routing tables, audit pipeline (Light/Core/Thorough modes), development workflow, and MCP integration recommendations.
