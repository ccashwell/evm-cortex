# EVM Cortex

**Ethereum Protocol Engineering Squad**

This file is for **Codex CLI** (OpenAI). If you're using Claude Code, see `CLAUDE.md` or just run `./install.sh`.

## What is this?

EVM Cortex turns your AI coding assistant into a specialized Ethereum protocol engineering team. Agents cover Solidity development, security auditing, DeFi integration, testing, and deployment -- everything needed to build, audit, and ship smart contracts.

## Setup (Codex CLI)

```bash
./install-codex.sh
```

## Prerequisites

- **Foundry**: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Slither**: `pip install slither-analyzer`
- **Aderyn** (optional): `cargo install aderyn`

## Agent Squads

### Core Protocol Development
| Agent | Role |
|-------|------|
| solidity-architect | Protocol design, upgradeability, system architecture |
| solidity-engineer | Implementation, best practices, NatSpec |
| gas-optimizer | Gas profiling, optimization, assembly |
| contract-deployer | Forge scripts, multi-chain deploy, verification |
| storage-layout-analyst | Storage slots, packing, proxy compatibility |
| protocol-designer | Mechanism design, game theory, incentives |

### Security Squad
| Agent | Role |
|-------|------|
| audit-orchestrator | Multi-phase audit pipeline (Light/Core/Thorough) |
| depth-state-trace | State variable mutation tracing |
| depth-token-flow | Token accounting, rounding, decimals |
| depth-edge-case | Boundary conditions, empty state, extremes |
| depth-external | External calls, reentrancy, callbacks |
| security-verifier | PoC construction and verification |
| invariant-analyst | Protocol invariant identification |
| access-control-reviewer | Permission analysis, privilege escalation |
| oracle-analyst | Price feed safety, manipulation resistance |
| mev-analyst | Front-running, sandwich, MEV analysis |

### Testing Squad
| Agent | Role |
|-------|------|
| foundry-tester | Unit, fuzz, fork tests with Foundry |
| invariant-tester | Stateful invariant testing |
| formal-verifier | Certora, Halmos, symbolic execution |
| fuzzer | Medusa, Echidna stateful fuzzing |
| poc-writer | Exploit PoC development |

### DeFi Specialists
| Agent | Role |
|-------|------|
| defi-architect | DeFi protocol design, composability |
| amm-expert | AMM mechanics, Uniswap V4 hooks |
| lending-expert | Lending/borrowing, liquidation |
| oracle-expert | Chainlink, TWAP, oracle design |
| bridge-expert | Cross-chain messaging, bridges |
| tokenomics-analyst | Token economics, vesting, governance |
| yield-strategist | Vault strategies, ERC-4626 |

### Uniswap Specialists
| Agent | Role |
|-------|------|
| uniswap-v4-expert | V4 PoolManager, flash accounting, hooks, PositionManager, production integration |
| uniswap-v3-expert | V3 Factory/Pool, NonfungiblePositionManager, SwapRouter, oracle system |
| uniswap-math-expert | Q64.96 math, TickMath, SqrtPriceMath, SwapMath, fee accounting |
| lp-analyst | LP position analysis, impermanent loss, fee revenue, range optimization |
| pool-finder | Pool discovery, state inspection, TVL/volume analysis, route optimization |

### Tooling & Infrastructure
| Agent | Role |
|-------|------|
| foundry-expert | Forge, Cast, Anvil, Chisel |
| openzeppelin-expert | OZ Contracts v5 library |
| slither-analyst | Static analysis interpretation |
| subgraph-builder | The Graph subgraph development |
| dapp-frontend | Wagmi, Viem, RainbowKit |
| devops-chain | CI/CD for Solidity, GitHub Actions |

### Standards & Governance
| Agent | Role |
|-------|------|
| eip-expert | EIP/ERC lifecycle, standards |
| erc-implementer | Token standard implementation |
| upgrade-planner | Proxy patterns, upgrade safety |
| governance-designer | Governor, Timelock, voting |
| l2-specialist | L2 deployment, bridging |

### Cross-Cutting
| Agent | Role |
|-------|------|
| planner | Protocol development planning |
| code-reviewer | Solidity code review |
| scout | Codebase exploration |
| sleuth | Smart contract bug investigation |
| scribe | NatSpec, documentation, reports |
| verifier | Final quality gate before deploy |

## Key Rules

### Stablecoin Integration
USDC has 6 decimals (see `usdc-integration` skill). Always use native Circle-issued USDC, never bridged variants (USDbC, USDC.e). For cross-chain USDC, see `cctp-bridging` skill. Use SafeERC20 for all transfers.

### Security First
Use checks-effects-interactions. Use ReentrancyGuard. Use SafeERC20. USDC has 6 decimals. USDT does not return bool on transfer. Never trust external calls.

### Foundry Workflow
TDD with Foundry: write test first (RED), implement (GREEN), optimize. `forge snapshot` for gas baselines. `slither .` before every PR.

### Gas Awareness
Gas is under 1 gwei in 2026. Mainnet is cheap. But still optimize: storage packing, calldata over memory, custom errors, immutables.

### Audit Mindset
Write code as if it will be audited tomorrow. Document invariants. Test edge cases (0, 1, max, empty). Use `xray-pre-audit` for reconnaissance and `pashov-audit-pipeline` for the full 8-agent parallelized audit.

### Conventions
- Say "onchain" not "on-chain"
- Never hallucinate contract addresses -- verify with `cast code`
- Custom errors over require strings
- Named imports over wildcard imports
- NatSpec on all public/external functions

## Git Conventions
- Commit format: `<type>: <description>`
- Types: feat, fix, refactor, docs, test, chore, perf, ci, audit
- Keep commits atomic and focused

## Links
- GitHub: https://github.com/ccashwell/evm-cortex
- Foundry: https://book.getfoundry.sh/
- OpenZeppelin: https://docs.openzeppelin.com/contracts/5.x/
- ethskills: https://ethskills.com/SKILL.md
