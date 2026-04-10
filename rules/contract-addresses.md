# Contract Addresses

## Golden Rule
NEVER hallucinate a contract address. Wrong address = lost funds.

## Verification Before Use
Always verify any address before hardcoding:
```bash
# Check contract has code
cast code <address> --rpc-url <rpc>

# Check it's the right contract
cast call <address> "symbol()(string)" --rpc-url <rpc>
cast call <address> "name()(string)" --rpc-url <rpc>

# Check for proxy - read implementation slot
cast storage <address> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url <rpc>
```

## Well-Known Addresses
Use factory/registry patterns instead of hardcoding pool addresses:
```solidity
// Good — use factory to get pool address
address pool = IUniswapV3Factory(FACTORY).getPool(tokenA, tokenB, fee);

// Bad — hardcoded pool address that could change
address pool = 0x1234...;
```

## Cross-Chain Addresses
- CREATE2 addresses may differ across chains if constructor args differ
- Multicall3: `0xcA11bde05977b3631167028862bE2a173976CA11` (same on all chains)
- Always maintain a deployment registry mapping chain ID -> addresses
- Never assume same address on L1 and L2

## Trusted Sources
- Protocol documentation (official docs)
- Etherscan/Blockscout verified contracts
- Protocol factory contracts (derive addresses, don't hardcode)
- `cast code` + `cast call` to verify onchain
