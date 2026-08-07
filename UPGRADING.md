# Upgrading EVM Cortex

Guide for upgrading between EVM Cortex versions.

## Quick Upgrade

```bash
cd evm-cortex
git pull origin main
./install.sh --update
```

**`--update` is required.** Without it the installer runs in add-only mode: it installs skills and agents you don't have yet, but never modifies one that already exists. On an existing install that means an upgrade brings in *new* content only, and every skill, agent, hook, and rule you already had stays at its old version.

Add-only mode now tells you when that happens — it lists every file on disk that differs from the version in the repo and prints the command to replace them. If you see an `OUT OF DATE` count, you have not finished upgrading.

`--update` backs up `~/.claude/{agents,skills,hooks,rules}` to `~/.claude/backup-<timestamp>/` first, then replaces only the files EVM Cortex ships. Agents and skills you created yourself are never touched, because the installer iterates over repo content and never scans your directory for things to delete.

Skill directories are **replaced rather than merged**, so a skill that was restructured upstream does not leave stale files behind. If you hand-edited a shipped skill, copy your version aside before updating — the backup has it, but the backup is easier to use if you know to look.

The same applies to the other installers:

```bash
./install-codex.sh --update
./install-openclaw.sh --update
./install-cursor.sh /path/to/project --update
```

## File Categories

### Safe to Overwrite

These files are maintained by EVM Cortex and are what `--update` replaces:

| Path | Content |
|------|---------|
| `agents/*.md` | Agent definitions |
| `skills/*/` | Skill definitions, plus any `references/`, `scripts/`, and `templates/` a skill ships |
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

### Unreleased

**Installers now support upgrading.** Previously the default mode skipped every existing file and reported the result as "Skipped: N (already existed)", which made an upgrade a silent no-op — the documented `git pull && ./install.sh` flow updated nothing. Default mode now distinguishes *already current* from *out of date*, lists the stale files, and points at `--update`. `install-cursor.sh` gained overwrite support, which it previously lacked entirely.

**Pashov skills synced with upstream.** `pashov-audit-pipeline` moved to solidity-auditor v3 (8 agents to 12, attacker framing, four judging gates), `xray-pre-audit` to x-ray v2 (readiness report with cross-linked invariants), and `fizz` was added with its `fizz-sync` and `fizz-convert` companions for Echidna/Medusa suite generation. Skills total 94.

These three skills now ship `references/`, `scripts/`, and `templates/` subdirectories alongside `SKILL.md`. An upgrade must therefore replace the whole skill directory, which is why `--update` replaces rather than merges.

**Added `simao-audit-pipeline`.** An accounting-first audit skill vendored from [0xSimao AI](https://github.com/0xsimao/0xsimao-ai) (VERSION 1.0.0), reverse-engineered from 0xSimao's 869 published findings. The orchestrator builds a money map (assets, tracked totals, asymmetry table, invariants, lifecycles, cohorts), then runs 12 parallel single-specialty lenses over it, deduplicates through four hard gates, and emits severity-classified findings with Foundry PoCs for Highs. It ships a `references/` subdirectory (method, severity calibration, report formatting, 12 attack lenses + shared rules) carried over from upstream intact; the EVM Cortex adaptations (agent mapping, Foundry pre-flight, PoC routing) live in `SKILL.md` only. Skills total 95.

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
