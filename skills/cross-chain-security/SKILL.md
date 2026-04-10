---
name: cross-chain-security
description: Cross-chain security patterns for multi-chain Solidity deployments and bridge interactions. Use when deploying contracts across multiple chains, integrating with bridges, or handling chain-specific behavior differences. Covers message replay, finality, and chain-specific gotchas.
---

# Cross-Chain Security

## Message Replay Across Chains

Signatures and messages valid on one chain can be replayed on another if the chain ID isn't included.

```solidity
// VULNERABLE: no chain ID in domain separator
bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(
    keccak256("EIP712Domain(string name,address verifyingContract)"),
    keccak256("MyProtocol"),
    address(this)
));

// FIXED: include chain ID
bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
    keccak256("MyProtocol"),
    keccak256("1"),
    block.chainid,
    address(this)
));
```

### Recomputing Domain Separator on Fork

If a chain forks, `block.chainid` changes but a cached domain separator doesn't.

```solidity
uint256 private immutable _CACHED_CHAIN_ID;
bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

constructor() {
    _CACHED_CHAIN_ID = block.chainid;
    _CACHED_DOMAIN_SEPARATOR = _computeDomainSeparator();
}

function DOMAIN_SEPARATOR() public view returns (bytes32) {
    if (block.chainid == _CACHED_CHAIN_ID) {
        return _CACHED_DOMAIN_SEPARATOR;
    }
    return _computeDomainSeparator();
}
```

## Bridge Verification

Never trust bridge messages blindly. Verify the source chain, sender, and message format.

```solidity
interface ICrossDomainMessenger {
    function xDomainMessageSender() external view returns (address);
}

contract L2Vault {
    address public immutable L1_BRIDGE;
    address public immutable MESSENGER;

    error NotFromBridge();
    error InvalidL1Sender();

    modifier onlyBridge() {
        if (msg.sender != MESSENGER) revert NotFromBridge();
        if (ICrossDomainMessenger(MESSENGER).xDomainMessageSender() != L1_BRIDGE) {
            revert InvalidL1Sender();
        }
        _;
    }

    function handleMessage(bytes calldata data) external onlyBridge {
        // safe to process — verified from L1_BRIDGE via canonical messenger
    }
}
```

## Finality Assumptions

Different chains have different finality guarantees.

| Chain | Finality | Notes |
|-------|----------|-------|
| Ethereum L1 | ~13 min (2 epochs) | Reorgs very rare post-merge |
| Optimism | 7-day challenge period | Optimistic rollup — wait for finality |
| Arbitrum | 7-day challenge period | Optimistic rollup |
| zkSync | Minutes (proof time) | ZK rollup — faster finality |
| Polygon PoS | ~2 min | Checkpoints to Ethereum |
| Base | 7-day challenge period | OP Stack |

```solidity
// Don't act on cross-chain messages until finality is reached
// For optimistic rollups, this means waiting for the challenge period
// For ZK rollups, wait for proof verification on L1
```

## Chain-Specific Behavior Differences

### PUSH0 Opcode (EIP-3855)

Available on Ethereum (Shanghai), not on all L2s or older EVMs.

```solidity
// Solidity 0.8.20+ uses PUSH0 by default
// If deploying to chains without PUSH0, compile with:
// solc --evm-version paris  (pre-Shanghai)

// foundry.toml
// evm_version = "paris"
```

### block.number

```solidity
// Ethereum L1: increments every ~12 seconds
// Arbitrum: block.number returns L1 block number (NOT Arbitrum block)
//           Use ArbSys.arbBlockNumber() for Arbitrum blocks
// Optimism: block.number returns L2 block number
// zkSync: block.number returns L2 batch number

// VULNERABLE: assuming block.number behavior
uint256 public lastActionBlock = block.number;

// SAFER: use block.timestamp for time-based logic (consistent across chains)
uint256 public lastActionTimestamp = block.timestamp;
```

### block.basefee and PREVRANDAO

```solidity
// block.basefee: may be 0 on some L2s
// block.prevrandao (was block.difficulty): not available or 0 on most L2s
// Never use these for randomness on L2
```

### msg.sender on L2

```solidity
// On Optimism/Base, for L1→L2 messages:
// msg.sender = L2CrossDomainMessenger
// Use xDomainMessageSender() to get the actual L1 sender

// On Arbitrum:
// msg.sender = aliased address for L1→L2 calls
// alias = L1Address + 0x1111000000000000000000000000000000001111
```

## CREATE2 Address Differences

Same CREATE2 salt + bytecode = same address on all chains, but only if:
- Same deployer address
- Same constructor arguments
- Same compiler settings (optimizer, version)

```solidity
// Risk: deploying "same" contract on two chains at same address
// but with different constructor args → different behavior, same address
// Users might trust the address based on one chain's deployment

// Defense: verify deployments independently per chain
```

## Cross-Chain Token Bridging Gotchas

```solidity
// Different token representations across chains:
// - USDC on Ethereum: native Circle deployment
// - USDC on Arbitrum: bridged via Arbitrum bridge (USDC.e) vs native (USDC)
// - USDC on Optimism: bridged via OP bridge vs native

// Always verify the correct token address per chain
// Don't assume same address = same token across chains

mapping(uint256 => address) public chainToUSDC;

constructor() {
    chainToUSDC[1] = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;     // Ethereum
    chainToUSDC[42161] = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // Arbitrum native
    chainToUSDC[10] = 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85;    // Optimism native
}
```

## Cross-Chain Governance

```solidity
// Governance on L1, execution on L2 requires:
// 1. Proposal passes on L1
// 2. Message sent via canonical bridge
// 3. L2 timelock receives and queues
// 4. Execution after L2 timelock delay

// Total delay = L1 voting + bridge finality + L2 timelock
// For optimistic rollups: voting period + 7 days + L2 delay
```

## Cross-Chain Security Checklist

- [ ] EIP-712 domain separator includes `chainId`
- [ ] Domain separator recomputed if `block.chainid` changes (fork handling)
- [ ] Bridge messages verified: source chain, sender, messenger
- [ ] Finality assumptions documented per chain
- [ ] `block.number` not relied upon for cross-chain consistency
- [ ] `block.timestamp` used for time-based logic (more portable)
- [ ] Compiler EVM version matches target chain capabilities
- [ ] CREATE2 deployments verified independently per chain
- [ ] Token addresses verified per chain (no cross-chain address assumptions)
- [ ] Cross-chain governance accounts for bridge finality delays
