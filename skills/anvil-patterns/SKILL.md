---
name: anvil-patterns
description: Use when running a local Ethereum node with Anvil. Covers forking, impersonation, mining modes, state snapshots, storage manipulation, RPC methods, and chain configuration.
---

# Anvil Local Node Patterns

## Basic Usage

```bash
# Start default local node (8545)
anvil

# Custom port and chain ID
anvil --port 8546 --chain-id 31337

# With specific number of accounts and balance
anvil --accounts 20 --balance 10000

# Specific mnemonic (reproducible addresses)
anvil --mnemonic "test test test test test test test test test test test junk"

# Specific block base fee
anvil --block-base-fee-per-gas 0
```

## Forking

Fork mainnet or any chain at the current or a specific block:

```bash
# Fork mainnet (latest block)
anvil --fork-url $ETH_RPC_URL

# Fork at specific block (reproducible state)
anvil --fork-url $ETH_RPC_URL --fork-block-number 18000000

# Fork Base
anvil --fork-url $BASE_RPC_URL --chain-id 8453

# Fork with retry and rate limiting
anvil --fork-url $ETH_RPC_URL --fork-retry-backoff 3 --compute-units-per-second 100

# No storage caching (fresh state each time)
anvil --fork-url $ETH_RPC_URL --no-storage-caching
```

## Impersonation

Send transactions as any address without its private key:

```bash
# Impersonate an address via RPC
cast rpc anvil_impersonateAccount 0xWhaleAddress

# Send tx as the impersonated address
cast send 0xToken "transfer(address,uint256)" 0xRecipient 1000000000000000000 \
  --from 0xWhaleAddress --unlocked --rpc-url http://127.0.0.1:8545

# Stop impersonating
cast rpc anvil_stopImpersonatingAccount 0xWhaleAddress
```

In Foundry tests, use `vm.prank()` instead:

```solidity
vm.prank(0xWhaleAddress);
token.transfer(recipient, amount);
```

## Mining Modes

```bash
# Auto-mine (default): mine a block for each transaction
anvil

# Interval mining: mine every N seconds
anvil --block-time 12

# Manual mining: no auto-mining
anvil --no-mining

# Mine a single block manually
cast rpc evm_mine --rpc-url http://127.0.0.1:8545

# Mine N blocks
cast rpc anvil_mine 10 --rpc-url http://127.0.0.1:8545

# Mine with specific timestamp
cast rpc evm_mine "0x$(printf '%x' 1700000000)" --rpc-url http://127.0.0.1:8545
```

## State Manipulation

```bash
# Set ETH balance
cast rpc anvil_setBalance 0xAddress "0xDE0B6B3A7640000" # 1 ETH in hex

# Set ERC-20 balance (write to storage slot directly)
# First find the balance slot: for most tokens, balanceOf mapping is slot 0 or slot 2
SLOT=$(cast index address 0xAddress 0)
cast rpc anvil_setStorageAt 0xTokenAddress $SLOT \
  "0x0000000000000000000000000000000000000000000000000DE0B6B3A7640000"

# Set nonce
cast rpc anvil_setNonce 0xAddress "0x10"

# Set contract code
cast rpc anvil_setCode 0xAddress "0x608060405234..."

# Set block timestamp
cast rpc evm_setNextBlockTimestamp "0x$(printf '%x' $(date +%s))"

# Increase time by N seconds
cast rpc evm_increaseTime 3600  # +1 hour
```

## State Snapshots

Save and restore chain state:

```bash
# Take snapshot (returns snapshot ID)
SNAP_ID=$(cast rpc evm_snapshot --rpc-url http://127.0.0.1:8545)

# ... make changes ...

# Revert to snapshot
cast rpc evm_revert $SNAP_ID --rpc-url http://127.0.0.1:8545
```

## Anvil RPC Methods

| Method | Description |
|--------|-------------|
| `anvil_impersonateAccount` | Act as any address |
| `anvil_stopImpersonatingAccount` | Stop impersonation |
| `anvil_setBalance` | Set ETH balance |
| `anvil_setCode` | Set contract bytecode |
| `anvil_setNonce` | Set account nonce |
| `anvil_setStorageAt` | Set storage slot |
| `anvil_mine` | Mine N blocks |
| `anvil_reset` | Reset fork to block |
| `anvil_dumpState` | Dump full state |
| `anvil_loadState` | Load state dump |
| `evm_snapshot` | Snapshot state |
| `evm_revert` | Revert to snapshot |
| `evm_setNextBlockTimestamp` | Set next block time |
| `evm_increaseTime` | Advance time |
| `evm_mine` | Mine one block |
| `evm_setAutomine` | Toggle auto-mining |

## State Dump and Load

Persist local state across sessions:

```bash
# Dump state to file
cast rpc anvil_dumpState --rpc-url http://127.0.0.1:8545 > state.json

# Later, start anvil and load state
anvil &
cast rpc anvil_loadState "$(cat state.json)" --rpc-url http://127.0.0.1:8545
```

## Fork Testing Pattern

```bash
# Terminal 1: Start fork
anvil --fork-url $ETH_RPC_URL --fork-block-number 18000000

# Terminal 2: Run tests against fork
forge test --fork-url http://127.0.0.1:8545

# Or script against fork
forge script script/Simulate.s.sol --fork-url http://127.0.0.1:8545
```

## Anvil with Forge Tests

```solidity
// Fork in test setup
function setUp() public {
    // fork mainnet at specific block
    vm.createSelectFork("mainnet", 18_000_000);
}

function test_swapOnUniswap() public {
    address whale = 0xWhaleAddress;
    vm.startPrank(whale);
    // ... interact with real mainnet contracts
    vm.stopPrank();
}
```

## Tips

- Fork block pinning (`--fork-block-number`) ensures reproducible tests
- Use `--steps-tracing` for detailed EVM execution traces
- `anvil --silent` suppresses log output
- `--host 0.0.0.0` makes anvil accessible from other machines/containers
- Combine `--block-time 1` with `--no-mining` for manual control with fallback
- State dumps are base64-encoded; large forks produce large dump files
- `anvil_reset` with `--fork-url` and `--fork-block-number` lets you re-fork without restart
