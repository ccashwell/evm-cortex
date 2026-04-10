# Onchain Conventions

## Terminology
- **onchain** — one word, no hyphen. Ethereum community convention.
- **offchain** — one word, no hyphen.
- **EOA** — Externally Owned Account (wallet controlled by private key)
- **EIP** — Ethereum Improvement Proposal (protocol changes)
- **ERC** — Ethereum Request for Comments (application-level standards)
- **MEV** — Maximal Extractable Value (not "Miner Extractable Value")
- **DeFi** — Decentralized Finance (capital D, capital F)
- **dApp** — decentralized application (lowercase d)
- **L1/L2** — Layer 1 / Layer 2 (capital L)
- **TVL** — Total Value Locked
- **LP** — Liquidity Provider
- **AMM** — Automated Market Maker

## Address Formatting
- Always display checksummed addresses (EIP-55)
- Use ENS names when available alongside addresses
- Never truncate addresses in code/contracts (only in UI)

## Units
- ETH amounts: use `ether` keyword (`1 ether` = 1e18 wei)
- Time: use Solidity time units (`1 days`, `1 hours`, `1 weeks`)
- Basis points: 1 bps = 0.01%, 10000 bps = 100%
- Percentages in contracts: use basis points (uint16, max 10000)

## Contract Addresses
- NEVER hallucinate an address. Wrong address = lost funds.
- Always verify addresses with `cast code <address>` before using
- Use well-known registries (Uniswap factory, Aave pool provider)
- Document all hardcoded addresses with comments showing source

## Community Conventions
- Solidity: follow official Solidity Style Guide
- OpenZeppelin: use OZ contracts as base, don't reimplement
- Foundry: standard project structure (src/, test/, script/, lib/)
- Testing: use forge test, not truffle/hardhat test
