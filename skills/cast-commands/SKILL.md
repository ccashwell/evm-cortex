---
name: cast-commands
description: Use when interacting with Ethereum contracts and data from the command line using Foundry's cast. Covers read/write calls, storage inspection, ABI encoding/decoding, block queries, and common one-liners.
---

# Cast CLI Reference

## Overview

`cast` is Foundry's command-line tool for interacting with EVM chains. Read state, send transactions, decode data, and inspect contracts without writing scripts.

## Reading State (cast call)

```bash
# Read a view function
cast call 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  "balanceOf(address)(uint256)" 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  --rpc-url $ETH_RPC_URL

# Read with named outputs
cast call 0xUniswapV3Pool "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" \
  --rpc-url $ETH_RPC_URL

# Call at a specific block
cast call 0xContract "totalSupply()(uint256)" --block 18000000 --rpc-url $ETH_RPC_URL

# Call to another address (simulated msg.sender)
cast call --from 0xWhale 0xContract "balanceOf(address)(uint256)" 0xWhale
```

## Writing State (cast send)

```bash
# Send a transaction
cast send 0xToken "transfer(address,uint256)" 0xRecipient 1000000 \
  --private-key $PRIVATE_KEY --rpc-url $ETH_RPC_URL

# Approve spending
cast send 0xToken "approve(address,uint256)" 0xSpender $(cast max-uint) \
  --private-key $PRIVATE_KEY --rpc-url $ETH_RPC_URL

# Send with value (ETH)
cast send 0xContract "deposit()" --value 1ether \
  --private-key $PRIVATE_KEY --rpc-url $ETH_RPC_URL

# Send with gas settings
cast send 0xContract "doStuff()" \
  --gas-limit 500000 --gas-price 30gwei \
  --private-key $PRIVATE_KEY --rpc-url $ETH_RPC_URL
```

## Storage Inspection (cast storage)

```bash
# Read raw storage slot
cast storage 0xContract 0 --rpc-url $ETH_RPC_URL

# Read specific slot (e.g., ERC-1967 implementation slot)
cast storage 0xProxy \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url $ETH_RPC_URL

# Read mapping value: slot = keccak256(key . mappingSlot)
# For mapping at slot 2, key = 0xAddress:
cast index address 0xAddress 2
# Then read that computed slot
cast storage 0xContract $(cast index address 0xAddress 2)
```

## ABI Encoding / Decoding

```bash
# Encode function calldata
cast calldata "transfer(address,uint256)" 0xRecipient 1000000

# Decode calldata
cast 4byte-decode 0xa9059cbb000000000000000000000000...

# Encode constructor arguments
cast abi-encode "constructor(string,string,uint256)" "MyToken" "MTK" 1000000

# Decode ABI-encoded data
cast abi-decode "balanceOf(address)(uint256)" 0x00000000000000000000000000000000000000000000000000000000000f4240

# Get function selector (first 4 bytes of keccak256)
cast sig "transfer(address,uint256)"
# Output: 0xa9059cbb

# Reverse lookup selector
cast 4byte 0xa9059cbb
```

## Block and Chain Info

```bash
# Current block number
cast block-number --rpc-url $ETH_RPC_URL

# Block details
cast block latest --rpc-url $ETH_RPC_URL
cast block 18000000 --rpc-url $ETH_RPC_URL

# Base fee
cast base-fee --rpc-url $ETH_RPC_URL

# Gas price
cast gas-price --rpc-url $ETH_RPC_URL

# Chain ID
cast chain-id --rpc-url $ETH_RPC_URL

# Client version
cast client --rpc-url $ETH_RPC_URL
```

## Contract Inspection

```bash
# Get contract bytecode
cast code 0xContract --rpc-url $ETH_RPC_URL

# Get contract bytecode size
cast code 0xContract --rpc-url $ETH_RPC_URL | wc -c

# Generate interface from Etherscan
cast interface 0xContract --etherscan-api-key $ETHERSCAN_API_KEY

# Download verified source from Etherscan
cast etherscan-source 0xContract --etherscan-api-key $ETHERSCAN_API_KEY -d ./source
```

## Account and Balance

```bash
# ETH balance
cast balance 0xAddress --rpc-url $ETH_RPC_URL
cast balance 0xAddress --rpc-url $ETH_RPC_URL --ether  # human-readable

# Nonce
cast nonce 0xAddress --rpc-url $ETH_RPC_URL

# Resolve ENS
cast resolve-name vitalik.eth --rpc-url $ETH_RPC_URL
cast lookup-address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --rpc-url $ETH_RPC_URL
```

## Transaction Inspection

```bash
# Get transaction details
cast tx 0xTxHash --rpc-url $ETH_RPC_URL

# Get transaction receipt
cast receipt 0xTxHash --rpc-url $ETH_RPC_URL

# Decode transaction input
cast 4byte-decode $(cast tx 0xTxHash input --rpc-url $ETH_RPC_URL)

# Trace a transaction (requires archive node)
cast run 0xTxHash --rpc-url $ETH_RPC_URL
```

## Conversion Utilities

```bash
# Wei to ether
cast from-wei 1000000000000000000
# Output: 1.000000000000000000

# Ether to wei
cast to-wei 1.5
# Output: 1500000000000000000

# Hex to decimal
cast to-dec 0xff
# Output: 255

# Decimal to hex
cast to-hex 255
# Output: 0xff

# Keccak256 hash
cast keccak "Transfer(address,address,uint256)"

# Max uint256
cast max-uint
# Output: 115792089237316195423570985008687907853269984665640564039457584007913129639935
```

## Common One-Liners

```bash
# Check if address is a contract
cast code 0xAddress --rpc-url $ETH_RPC_URL | grep -q "^0x$" && echo "EOA" || echo "Contract"

# Get USDC balance (6 decimals)
cast call 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  "balanceOf(address)(uint256)" 0xAddress --rpc-url $ETH_RPC_URL | \
  xargs -I{} cast from-wei {} 6

# Read ERC-1967 proxy implementation
cast storage 0xProxy \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url $ETH_RPC_URL

# Simulate a swap (static call)
cast call 0xRouter \
  "getAmountsOut(uint256,address[])(uint256[])" \
  1000000000000000000 "[0xWETH,0xUSDC]" \
  --rpc-url $ETH_RPC_URL

# Estimate gas for a transaction
cast estimate 0xContract "doStuff(uint256)" 42 --rpc-url $ETH_RPC_URL

# Watch for new blocks
cast block-number --rpc-url $ETH_RPC_URL --watch
```

## Tips

- Set `ETH_RPC_URL` environment variable to avoid `--rpc-url` on every command
- Use `--json` flag for machine-readable output
- Pipe cast output to other cast commands for complex queries
- Use `cast wallet` subcommands for key management
- `cast completions bash/zsh/fish` generates shell completions
