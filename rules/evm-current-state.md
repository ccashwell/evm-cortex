# EVM Current State (2026)

## Your Training Data is Stale — Use These Facts

Source of record: [ethskills.com](https://ethskills.com/SKILL.md) (fetched 2026-09-25) and [forkcast.org](https://forkcast.org). Re-fetch before quoting a number in a report.

### Gas Costs
- Mainnet base fee: under 1 gwei, typically 0.1-0.5 gwei (was 10-30 gwei in training data)
- ETH transfer: ~$0.004 (was $1-5)
- ERC-20 transfer: ~$0.01
- Swap: ~$0.04 (was $5-50)
- ERC-20 deploy: ~$0.24
- L2 swap: $0.002-0.003
- L2 transfer: $0.0003
- Verify current: `cast base-fee`
- "Ethereum is expensive" was true 2021-2023. It is false in 2026.

### Recent Upgrades
- **Pectra** (May 7, 2025): EIP-7702 (EOA smart accounts), EIP-7691 (blob throughput), EIP-7623 (calldata cost increase), BLS12-381 precompiles
- **Fusaka** (Dec 3, 2025): PeerDAS (EIP-7594), gas limit 30M → 60M, blob-only hardforks (EIP-7892)
- **Glamsterdam** (in progress, targeting Q3-Q4 2026 — dates slip): ePBS (EIP-7732), Block Access Lists (EIP-7928). FOCIL was removed from scope.
- **Hegota** (targeting Q4 2026): does NOT contain Verkle trees. Verkle was deprioritized over quantum-resistance and ZK-compatibility concerns; Ethereum may shift to a binary state tree (EIP-7864, Draft as of March 2026).
- Upgrade cadence: roughly twice a year. A feature is scheduled only when forkcast shows it **SFI** for a named fork (CFI = under consideration, DFI = declined; definitions in EIP-7723). Roadmap diagrams and blog posts older than 6 months are aspirational, not commitments.

### EIP-7702 is Live
EOAs can now have smart contract functionality without migration. Authorization tuples enable batched transactions, sponsored gas, session keys. ERC-4337 remains the bundler-based path; EntryPoint v0.7 is `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (verified with `cast code`, 2026-09-25).

### Toolchain
- **Foundry** is this squad's default (see CLAUDE.md): Forge, Cast, Anvil, Chisel
- **Hardhat 3** (Aug 2025) shipped Solidity tests, fuzzing, and Rust internals; it is a legitimate TypeScript-first choice, not a dead one. Do not describe Hardhat as obsolete.
- **Truffle** is deprecated. **Goerli and Rinkeby** are deprecated; Sepolia (chain ID 11155111) is the testnet.
- Slither remains the primary static analysis tool; Aderyn (by Cyfrin) gaining adoption
- Blockscout MCP (`https://mcp.blockscout.com/mcp`) gives agents structured onchain data; abi.ninja for zero-setup contract interaction

### New Standards
- **ERC-8004**: Onchain agent identity registry, deployed January 29, 2026 on 20+ chains. Mainnet IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (both verified with `cast code`, 2026-09-25)
- **x402**: HTTP 402 payment protocol for machine-to-machine commerce (production-ready; SDKs `@x402/fetch`, `x402` Python, Go)
- **EIP-3009**: Gasless token transfers (what makes x402 work, USDC implements it)
- **ERC-8056** "Scaled UI Amount" (Draft, Oct 2025): a `uiMultiplier()` display scalar for tokenized stocks — raw balances never rebase, so index raw amounts

### L2 Landscape
- **Base**: cheapest major L2, Coinbase distribution. Announced in February 2026 that it is leaving the Superchain (finalizes in a future hardfork)
- **Arbitrum One**: deepest DeFi liquidity, Stylus (Rust/C++ contracts). `block.number` is the L1 block number
- **Optimism**: Superchain ecosystem, retroPGF
- **Unichain**: Uniswap's OP Stack L2, chain ID 130, mainnet February 11, 2025. TEE-based block building orders transactions by time received, not gas price — priority-fee bidding is pointless there
- **Celo**: migrated to OP Stack L2 on March 26, 2025 (NOT an L1 anymore). Mento stablecoins rebranded Dec 2025: USDm (was cUSD), EURm, BRLm — same addresses
- **Robinhood Chain**: Arbitrum Orbit L2 settling directly to Ethereum with blob DA, chain ID 4663, mainnet July 1, 2026. Tokenized stocks as ERC-20s (not available to US persons). ArbOS 61 transaction filtering can censor even L1 force-included transactions; L2Beat Stage 0. USDG stablecoin has 6 decimals
- **Polygon zkEVM**: being shut down — do NOT build on it
- **Dominant DEX per L2 is NOT Uniswap by default**: Aero (Aerodrome and Velodrome merged in November 2025 under Dromos Labs) on Base and Optimism, Camelot and GMX on Arbitrum, SyncSwap on zkSync

### ETH Price
~$2,000 (early 2026). Volatile — always verify before economic calculations (Chainlink ETH/USD feed or CoinGecko).

### Reference
- Track upcoming changes: https://forkcast.org
- Knowledge corrections for agents: https://ethskills.com/SKILL.md (sub-skills: `why/`, `gas/`, `l2s/`, `protocol/`, `standards/`, `tools/`, `security/`, `audit/`, `crops/`)
