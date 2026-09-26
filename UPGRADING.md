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

**Added `simao-audit-pipeline`.** An accounting-first audit skill vendored from [0xSimao AI](https://github.com/0xsimao/0xsimao-ai) (VERSION 1.0.0), reverse-engineered from 0xSimao's 869 published findings. The orchestrator builds a money map (assets, tracked totals, asymmetry table, invariants, lifecycles, cohorts), then runs 12 parallel single-specialty lenses over it, deduplicates through four hard gates, and emits severity-classified findings with Foundry PoCs for Highs. It ships a `references/` subdirectory (method, severity calibration, report formatting, 12 attack lenses + shared rules) carried over from upstream intact except for the repo's `onchain` spelling normalization; the EVM Cortex adaptations (agent mapping, Foundry pre-flight, PoC routing) live in `SKILL.md` only. Skills total 95.

**`pashov-audit-pipeline` synced to solidity-auditor v4.** Upstream (2026-09-23) added loop mode (`--loop N` passes per scan, each pass told what earlier passes found, one combined report), a findings ledger across scans (`--memory`, on automatically when passes > 1, stored at `.solidity-auditor/memory.tsv` in the audited repo), and a shell-assembled report: each pass writes its gated findings to a run file and `references/assemble.sh` is the only thing that produces `full-report.md`, so the report can never overstate its coverage. Findings are worded in Simplified Technical English (`report-language.md`, appended to every agent bundle), the confidence threshold moved from 80 to 75, deploy scripts are now in scope, agents are READ-ONLY in the audited repo, and the upgrade warning fires only when the local `VERSION` is lower. Upstream's `SKILL.md` is vendored verbatim as `references/orchestration.md` so future syncs stay a file-by-file diff; the EVM Cortex layer (agent mapping, context package, Foundry pre-flight, a `**Severity**` line in each finding block, and a Turn 6 severity/PoC annex built by shell from the assembled report) lives in `SKILL.md`. PoCs are written under `.solidity-auditor/runs/{stamp}/poc/` and run with `FOUNDRY_TEST` overridden, never into the project's `test/`. Audited repos should gitignore `.solidity-auditor/`.

**EVM current-state facts refreshed from ethskills.com (2026-09-25).** `rules/evm-current-state.md` now records Fusaka as shipped (Dec 3, 2025), Glamsterdam as in progress for Q3-Q4 2026 with FOCIL dropped, and Hegota (Q4 2026) without Verkle; adds Unichain (chain ID 130, time-priority ordering) and Robinhood Chain (chain ID 4663, Orbit L2 whose transaction filtering can censor force-included transactions); notes the Aerodrome/Velodrome merger into Aero, Base's announced Superchain exit, and Hardhat 3 as a legitimate toolchain alongside this squad's Foundry default; and pins the ERC-8004 registry and ERC-4337 EntryPoint v0.7 addresses after `cast code` verification. `agents/eip-expert.md` had Fusaka as "targeting late 2026" and Glamsterdam as "2027+"; both corrected, with a CFI/SFI/DFI (EIP-7723) guide for checking fork scope on forkcast. `agents/l2-specialist.md` gained Unichain, Robinhood Chain, chain IDs, and the dominant-DEX-per-chain note. `skills/erc8004-patterns` replaces its `0x...` placeholder with the verified registry addresses.

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
