---
name: blockscout-mcp
description: Use when querying onchain data through Blockscout MCP. Covers contract source retrieval, transaction analysis, address balance queries, event log queries, and token information.
---

# Blockscout MCP Integration

## Overview

Blockscout provides a comprehensive API for querying onchain data. Through MCP (Model Context Protocol), you can access contract sources, transaction details, address information, and event logs programmatically.

## Blockscout API Endpoints

Base URLs by chain:

| Chain | Blockscout URL |
|-------|---------------|
| Ethereum | `https://eth.blockscout.com/api/v2` |
| Base | `https://base.blockscout.com/api/v2` |
| Optimism | `https://optimism.blockscout.com/api/v2` |
| Arbitrum | `https://arbitrum.blockscout.com/api/v2` |
| Gnosis | `https://gnosis.blockscout.com/api/v2` |

## Contract Source Retrieval

```bash
# Get verified contract source via API
curl "https://base.blockscout.com/api/v2/smart-contracts/0xContractAddress"

# Response includes:
# - source_code: full Solidity source
# - abi: contract ABI
# - compiler_version
# - optimization_enabled
# - constructor_args
```

Using cast:

```bash
# Download source from Blockscout-indexed chain
cast etherscan-source 0xContractAddress \
  --chain base \
  -d ./downloaded-source
```

## Address Queries

```bash
# Get address info (balance, tx count, token balances)
curl "https://base.blockscout.com/api/v2/addresses/0xAddress"

# Get token balances for an address
curl "https://base.blockscout.com/api/v2/addresses/0xAddress/token-balances"

# Get address transactions
curl "https://base.blockscout.com/api/v2/addresses/0xAddress/transactions"

# Get internal transactions
curl "https://base.blockscout.com/api/v2/addresses/0xAddress/internal-transactions"

# Get token transfers
curl "https://base.blockscout.com/api/v2/addresses/0xAddress/token-transfers"
```

## Transaction Analysis

```bash
# Get transaction details
curl "https://base.blockscout.com/api/v2/transactions/0xTxHash"

# Get transaction logs (events)
curl "https://base.blockscout.com/api/v2/transactions/0xTxHash/logs"

# Get internal transactions for a tx
curl "https://base.blockscout.com/api/v2/transactions/0xTxHash/internal-transactions"

# Get token transfers in a transaction
curl "https://base.blockscout.com/api/v2/transactions/0xTxHash/token-transfers"

# Get transaction state changes
curl "https://base.blockscout.com/api/v2/transactions/0xTxHash/state-changes"
```

## Event Log Queries

```bash
# Get logs by contract address
curl "https://base.blockscout.com/api?module=logs&action=getLogs\
&address=0xContractAddress\
&fromBlock=0\
&toBlock=latest\
&topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
# topic0 = keccak256("Transfer(address,address,uint256)")
```

## Token Information

```bash
# Get token details (name, symbol, decimals, total supply)
curl "https://base.blockscout.com/api/v2/tokens/0xTokenAddress"

# Get token holders
curl "https://base.blockscout.com/api/v2/tokens/0xTokenAddress/holders"

# Get token transfers
curl "https://base.blockscout.com/api/v2/tokens/0xTokenAddress/transfers"

# Get token instances (for NFTs)
curl "https://base.blockscout.com/api/v2/tokens/0xNFTAddress/instances"
```

## MCP Usage Patterns

### Query Contract State

```typescript
// Through MCP, query a contract's verified source and ABI
const contractInfo = await blockscoutMcp.getContract({
  chain: 'base',
  address: '0xContractAddress',
});

// Use ABI to decode transaction data
const decodedTx = await blockscoutMcp.decodeTransaction({
  chain: 'base',
  txHash: '0xTxHash',
  abi: contractInfo.abi,
});
```

### Monitor Contract Events

```typescript
// Fetch recent events from a contract
const logs = await blockscoutMcp.getLogs({
  chain: 'base',
  address: '0xContractAddress',
  fromBlock: 'latest-1000',
  toBlock: 'latest',
  topic0: '0x...', // event signature hash
});
```

### Investigate a Transaction

```typescript
// Full transaction breakdown
const tx = await blockscoutMcp.getTransaction({ chain: 'base', hash: '0x...' });
const logs = await blockscoutMcp.getTransactionLogs({ chain: 'base', hash: '0x...' });
const internal = await blockscoutMcp.getInternalTxs({ chain: 'base', hash: '0x...' });
const stateChanges = await blockscoutMcp.getStateChanges({ chain: 'base', hash: '0x...' });
```

## Blockscout vs Etherscan API

| Feature | Blockscout | Etherscan |
|---------|-----------|-----------|
| Open source | Yes | No |
| V2 API | REST, well-structured | Legacy format |
| Self-hostable | Yes | No |
| Multi-chain | Unified API | Separate domains |
| Rate limits | Generous | Restrictive |
| API key required | Usually no | Yes |
| State changes | Available | Limited |

## Useful Blockscout Queries for Debugging

```bash
# Check if contract is verified
curl -s "https://base.blockscout.com/api/v2/smart-contracts/0xAddr" | jq '.is_verified'

# Get proxy implementation address
curl -s "https://base.blockscout.com/api/v2/smart-contracts/0xProxy" | jq '.implementations'

# Get recent transactions for a contract
curl -s "https://base.blockscout.com/api/v2/addresses/0xAddr/transactions?limit=10"

# Search by text
curl -s "https://base.blockscout.com/api/v2/search?q=MyToken"

# Get block info
curl -s "https://base.blockscout.com/api/v2/blocks/18000000"
```

## Integration Checklist

- [ ] Use correct Blockscout instance URL for target chain
- [ ] Handle pagination for large result sets (`next_page_params`)
- [ ] Cache contract ABI/source after first retrieval
- [ ] Use V2 API endpoints where available (better structured)
- [ ] Fall back to Etherscan API if Blockscout instance is unavailable
- [ ] Check `is_verified` before trusting contract source
- [ ] Use `state-changes` endpoint for understanding tx effects
