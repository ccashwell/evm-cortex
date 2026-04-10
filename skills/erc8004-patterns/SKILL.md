---
name: erc8004-patterns
description: Use when integrating ERC-8004 onchain agent identity. Covers agent identity registry, authentication, capability declaration, trust framework for AI agents interacting onchain. Deployed January 2026 on 20+ chains.
---

# ERC-8004 Onchain Agent Identity

## Overview

ERC-8004 establishes a standard for AI agent identity onchain. Deployed in January 2026 across 20+ chains, it provides a registry for agents to declare their identity, capabilities, and trust relationships. This enables verifiable agent-to-agent and agent-to-protocol interactions.

## Core Interface

```solidity
interface IERC8004 {
    struct AgentIdentity {
        address agent;         // agent's onchain address (EOA or contract)
        bytes32 identityHash;  // hash of offchain identity metadata
        uint64 registeredAt;
        uint64 expiresAt;
        address operator;      // human or org that controls the agent
        uint8 trustLevel;      // 0-255 trust score
    }

    struct Capability {
        bytes32 capabilityId;  // keccak256 of capability name
        bytes params;          // ABI-encoded capability parameters
    }

    event AgentRegistered(address indexed agent, bytes32 identityHash, address indexed operator);
    event AgentRevoked(address indexed agent, address indexed revokedBy);
    event CapabilityDeclared(address indexed agent, bytes32 indexed capabilityId);

    function registerAgent(AgentIdentity calldata identity, Capability[] calldata capabilities) external;
    function revokeAgent(address agent) external;
    function getIdentity(address agent) external view returns (AgentIdentity memory);
    function getCapabilities(address agent) external view returns (Capability[] memory);
    function isRegistered(address agent) external view returns (bool);
    function hasCapability(address agent, bytes32 capabilityId) external view returns (bool);
    function verifyAgent(address agent, bytes32 requiredCapability) external view returns (bool);
}
```

## Registry Integration

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC8004} from "./interfaces/IERC8004.sol";

contract AgentGatedProtocol {
    IERC8004 public immutable agentRegistry;
    bytes32 public constant TRADE_CAPABILITY = keccak256("trade");
    bytes32 public constant REBALANCE_CAPABILITY = keccak256("rebalance");

    modifier onlyRegisteredAgent() {
        require(agentRegistry.isRegistered(msg.sender), "Not a registered agent");
        _;
    }

    modifier requiresCapability(bytes32 capId) {
        require(agentRegistry.verifyAgent(msg.sender, capId), "Missing capability");
        _;
    }

    constructor(address registry_) {
        agentRegistry = IERC8004(registry_);
    }

    function executeTrade(bytes calldata tradeData)
        external
        onlyRegisteredAgent
        requiresCapability(TRADE_CAPABILITY)
    {
        // Agent-executed trade logic
    }

    function rebalanceVault()
        external
        onlyRegisteredAgent
        requiresCapability(REBALANCE_CAPABILITY)
    {
        // Only agents with rebalance capability
    }
}
```

## Registering an Agent

```solidity
contract AgentDeployer {
    IERC8004 public registry;

    function deployAndRegister(
        address agentAddress,
        bytes32 identityHash,
        uint64 ttl
    ) external {
        IERC8004.AgentIdentity memory identity = IERC8004.AgentIdentity({
            agent: agentAddress,
            identityHash: identityHash,
            registeredAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp) + ttl,
            operator: msg.sender,
            trustLevel: 100
        });

        IERC8004.Capability[] memory caps = new IERC8004.Capability[](2);
        caps[0] = IERC8004.Capability({
            capabilityId: keccak256("trade"),
            params: abi.encode(1 ether) // max trade size
        });
        caps[1] = IERC8004.Capability({
            capabilityId: keccak256("rebalance"),
            params: ""
        });

        registry.registerAgent(identity, caps);
    }
}
```

## Identity Metadata (Offchain)

The `identityHash` references offchain metadata stored on IPFS or a similar system:

```json
{
    "name": "TradingBot-v2",
    "version": "2.1.0",
    "description": "Automated DeFi trading agent",
    "operator": {
        "name": "Acme Labs",
        "url": "https://acmelabs.xyz",
        "contact": "ops@acmelabs.xyz"
    },
    "model": "gpt-4-turbo",
    "capabilities": ["trade", "rebalance", "report"],
    "auditUrl": "https://audits.example.com/tradingbot-v2",
    "sourceCodeHash": "0xabc123..."
}
```

Compute the hash: `keccak256(abi.encodePacked(ipfsUri))`

## Trust Framework

```solidity
contract TrustOracle {
    IERC8004 public registry;

    mapping(address agent => mapping(address endorser => uint8 score)) public endorsements;

    function endorseAgent(address agent, uint8 score) external {
        require(registry.isRegistered(agent), "Agent not registered");
        require(registry.isRegistered(msg.sender), "Endorser not registered");
        endorsements[agent][msg.sender] = score;
    }

    function aggregateTrust(address agent, address[] calldata endorsers)
        external view returns (uint256)
    {
        uint256 total;
        for (uint256 i = 0; i < endorsers.length; i++) {
            total += endorsements[agent][endorsers[i]];
        }
        return endorsers.length > 0 ? total / endorsers.length : 0;
    }
}
```

## Agent-to-Agent Authentication

```solidity
contract AgentCollaboration {
    IERC8004 public registry;

    event TaskDelegated(address indexed from, address indexed to, bytes32 taskId);

    function delegateTask(address toAgent, bytes32 taskId, bytes calldata taskData) external {
        require(registry.verifyAgent(msg.sender, keccak256("delegate")), "Cannot delegate");
        require(registry.verifyAgent(toAgent, keccak256("execute")), "Cannot execute");

        IERC8004.AgentIdentity memory sender = registry.getIdentity(msg.sender);
        IERC8004.AgentIdentity memory receiver = registry.getIdentity(toAgent);

        require(sender.trustLevel >= 50, "Sender trust too low");
        require(receiver.trustLevel >= 50, "Receiver trust too low");

        emit TaskDelegated(msg.sender, toAgent, taskId);
    }
}
```

## Multi-Chain Registry Lookup

ERC-8004 is deployed at the same address on 20+ chains. Query the registry on any supported chain:

```typescript
import { createPublicClient, http } from 'viem';
import { base, optimism, arbitrum } from 'viem/chains';

const ERC8004_REGISTRY = '0x...'; // Same address on all chains

async function checkAgentOnChain(agentAddress: `0x${string}`, chain: any) {
  const client = createPublicClient({ chain, transport: http() });
  const isRegistered = await client.readContract({
    address: ERC8004_REGISTRY,
    abi: erc8004Abi,
    functionName: 'isRegistered',
    args: [agentAddress],
  });
  return isRegistered;
}
```

## Integration Checklist

- [ ] Verify agent registration before granting protocol access
- [ ] Check capability declarations match required permissions
- [ ] Validate agent identity has not expired (`expiresAt > block.timestamp`)
- [ ] Verify operator address for administrative actions
- [ ] Cross-reference trust scores from multiple endorsers
- [ ] Handle agent revocation events (listen for `AgentRevoked`)
- [ ] Store `identityHash` for offchain metadata verification
- [ ] Test multi-chain registry lookups for cross-chain agent operations
