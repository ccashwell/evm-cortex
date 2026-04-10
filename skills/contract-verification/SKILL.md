---
name: contract-verification
description: Use when verifying deployed contracts on block explorers. Covers forge verify-contract, Etherscan/Basescan/Arbiscan APIs, Blockscout verification, constructor args encoding, flattening, proxy verification, and multi-file verification.
---

# Contract Verification

## Why Verify

Verified contracts show source code on block explorers, enabling:
- Public auditability
- Etherscan read/write UI for interaction
- Trust from users and integrators
- Required for many DeFi integrations

## forge verify-contract

```bash
# Basic verification
forge verify-contract 0xContractAddress src/MyContract.sol:MyContract \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY

# With constructor arguments
forge verify-contract 0xContractAddress src/MyToken.sol:MyToken \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(string,string,uint256)" "MyToken" "MTK" 1000000000000000000000000)

# With compiler settings matching deployment
forge verify-contract 0xContractAddress src/MyContract.sol:MyContract \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --compiler-version v0.8.28 \
  --num-of-optimizations 200

# Watch verification status
forge verify-contract 0xContractAddress src/MyContract.sol:MyContract \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --watch
```

## Chain-Specific Verification

```bash
# Mainnet (Etherscan)
forge verify-contract $ADDR MyContract \
  --chain-id 1 --etherscan-api-key $ETHERSCAN_API_KEY

# Base (Basescan)
forge verify-contract $ADDR MyContract \
  --chain-id 8453 \
  --verifier etherscan \
  --verifier-url https://api.basescan.org/api \
  --etherscan-api-key $BASESCAN_API_KEY

# Optimism (Optimistic Etherscan)
forge verify-contract $ADDR MyContract \
  --chain-id 10 \
  --verifier etherscan \
  --verifier-url https://api-optimistic.etherscan.io/api \
  --etherscan-api-key $OPSCAN_API_KEY

# Arbitrum (Arbiscan)
forge verify-contract $ADDR MyContract \
  --chain-id 42161 \
  --verifier etherscan \
  --verifier-url https://api.arbiscan.io/api \
  --etherscan-api-key $ARBISCAN_API_KEY
```

## Blockscout Verification

```bash
# Blockscout uses a different verifier
forge verify-contract $ADDR MyContract \
  --chain-id 8453 \
  --verifier blockscout \
  --verifier-url https://base.blockscout.com/api/

# Blockscout doesn't require an API key for most instances
```

## Constructor Arguments

The most common verification failure is incorrect constructor args:

```bash
# Encode constructor args
cast abi-encode "constructor(address,uint256,string)" \
  0xAdminAddress 1000000 "MyToken"

# For complex types (arrays, structs)
cast abi-encode "constructor(address[])" \
  "[0xAddr1,0xAddr2,0xAddr3]"

# If constructor takes no args, omit --constructor-args entirely
```

## Flattening

When verification tools fail with import resolution, flatten the contract:

```bash
# Flatten to single file
forge flatten src/MyContract.sol > MyContract.flat.sol

# Verify using flattened source (manual Etherscan upload)
# 1. Go to etherscan.io/verifyContract
# 2. Select "Solidity (Single file)"
# 3. Paste flattened source
# 4. Set compiler version and optimizer settings to match deployment
```

## Proxy Verification

### Verify Implementation

```bash
# Verify the implementation contract first
forge verify-contract $IMPL_ADDR src/MyContract.sol:MyContract \
  --chain-id 1 --etherscan-api-key $ETHERSCAN_API_KEY
```

### Mark Proxy on Etherscan

After verifying the implementation, mark the proxy:

```bash
# Using Etherscan API to mark as proxy
curl "https://api.etherscan.io/api?module=contract&action=verifyproxycontract&apikey=$ETHERSCAN_API_KEY" \
  -d "address=$PROXY_ADDR"

# Check proxy verification status
curl "https://api.etherscan.io/api?module=contract&action=checkproxyverification&guid=$GUID&apikey=$ETHERSCAN_API_KEY"
```

### Verify ERC-1967 Proxy

```bash
# Verify the proxy contract itself (usually OpenZeppelin's)
forge verify-contract $PROXY_ADDR \
  lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" $IMPL_ADDR $INIT_DATA)
```

## Verification in Forge Scripts

```bash
# Verify during deployment (recommended)
forge script script/Deploy.s.sol \
  --rpc-url $ETH_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY

# This auto-verifies all deployed contracts with correct constructor args
```

## foundry.toml Etherscan Config

```toml
[etherscan]
mainnet = { key = "${ETHERSCAN_API_KEY}" }
sepolia = { key = "${ETHERSCAN_API_KEY}" }
base = { key = "${BASESCAN_API_KEY}", url = "https://api.basescan.org/api" }
optimism = { key = "${OPSCAN_API_KEY}", url = "https://api-optimistic.etherscan.io/api" }
arbitrum = { key = "${ARBISCAN_API_KEY}", url = "https://api.arbiscan.io/api" }
```

With this config, `forge verify-contract` auto-selects the right API based on `--chain-id`.

## Troubleshooting

### "Compiler version mismatch"

```bash
# Check what version was used to compile
forge build --force
# Look in out/MyContract.sol/MyContract.json → metadata → compiler

# Specify exact version
forge verify-contract $ADDR MyContract --compiler-version v0.8.28+commit.7893614a
```

### "Constructor arguments mismatch"

```bash
# Get constructor args from deployment tx
cast tx $DEPLOY_TX_HASH input --rpc-url $ETH_RPC_URL
# The constructor args are appended after the bytecode
# Compare with: cast abi-encode "constructor(...)" args...
```

### "Bytecode mismatch"

Ensure identical compiler settings:
- Same solc version
- Same optimizer settings (enabled, runs)
- Same EVM version
- Same via-ir setting
- Same remappings

```bash
# Rebuild with exact settings and compare
forge build --force
cast code $ADDR --rpc-url $ETH_RPC_URL > deployed.hex
# Compare with out/MyContract.sol/MyContract.json → deployedBytecode
```

## Verification Checklist

- [ ] Implementation contract verified first (for proxies)
- [ ] Constructor arguments correctly encoded
- [ ] Compiler version matches deployment exactly
- [ ] Optimizer settings match (runs, via-ir, evm-version)
- [ ] All imports are resolvable (check remappings)
- [ ] Proxy marked on Etherscan after implementation verified
- [ ] Verification confirmed on block explorer (green checkmark)
- [ ] Read/Write contract tabs work on explorer
