---
name: event-design
description: Event-first contract design for efficient onchain data indexing. Use when designing contracts for The Graph, Dune, or any offchain indexing system. Covers indexed parameters, naming conventions, event costs, and designing contracts event-first.
---

# Event Design

## Design Contracts Event-First

Events are the primary interface between onchain state and offchain systems. Design events **before** writing contract logic. Every state-changing function should emit at least one event.

```solidity
// Define events FIRST, then build the contract around them
interface IVaultEvents {
    event Deposited(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event FeeCollected(address indexed collector, uint256 amount);
    event StrategyUpdated(address indexed oldStrategy, address indexed newStrategy);
    event EmergencyShutdown(address indexed triggeredBy, uint256 timestamp);
}
```

## Indexed Parameters

- Max 3 indexed parameters per event (4 for anonymous events)
- Indexed parameters become log topics — filterable by indexers
- Non-indexed parameters go in the data section — cheaper, not filterable
- Value types (address, uint, bool, bytes32) are stored directly as topics
- Reference types (string, bytes, arrays) are stored as their keccak256 hash when indexed

```solidity
// GOOD: key actors indexed for filtering, amounts in data for reading
event Transfer(address indexed from, address indexed to, uint256 amount);

// GOOD: token indexed for per-token queries
event Swap(
    address indexed sender,
    address indexed tokenIn,
    address indexed tokenOut,
    uint256 amountIn,
    uint256 amountOut,
    uint256 fee
);

// BAD: indexing a string hashes it — you can't read the original value from the topic
event NameChanged(string indexed name); // topic = keccak256(name), not the string
```

### What to Index

| Parameter | Index? | Reason |
|-----------|--------|--------|
| User/sender address | Yes | Filter by user |
| Token address | Yes | Filter by token |
| Pool/vault ID | Yes | Filter by pool |
| Amounts | No | Read from data, not filtered |
| Timestamps | No | Block timestamp available anyway |
| Strings/bytes | No | Indexed = hashed = unreadable |

## Event Naming Conventions

- Use **past tense** for completed actions: `Deposited`, `Withdrawn`, `Transferred`
- Use **present/descriptive** for config changes: `FeeUpdated`, `OwnershipTransferred`
- Avoid generic names: `Updated` (updated what?), `Action` (what action?)

```solidity
// GOOD: specific, past tense
event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
event PositionLiquidated(address indexed owner, address indexed liquidator, uint256 debt, uint256 collateral);
event OracleUpdated(address indexed oldOracle, address indexed newOracle);

// BAD: vague
event Updated(uint256 value);
event Action(address user, uint256 amount);
```

## Log Gas Costs

| Component | Gas Cost |
|-----------|----------|
| Base log cost | 375 gas |
| Per topic | 375 gas |
| Per byte of data | 8 gas |
| Total for 3-topic event with 64 bytes data | ~2,137 gas |

Events are cheap relative to storage operations (~20,000 gas). Always emit events for state changes.

## Events for Offchain Indexing (The Graph)

Design events to match your subgraph schema. Each entity in your subgraph should map to one or more events.

```solidity
// Subgraph entity: Position
// Maps to events: PositionOpened, PositionClosed, PositionModified
event PositionOpened(
    uint256 indexed positionId,
    address indexed owner,
    address indexed market,
    bool isLong,
    uint256 size,
    uint256 collateral,
    uint256 entryPrice
);

event PositionClosed(
    uint256 indexed positionId,
    address indexed owner,
    uint256 exitPrice,
    int256 pnl,
    uint256 fee
);

// Include all fields the subgraph handler needs — avoid requiring
// additional contract reads in the handler (those are slow and expensive)
```

### Subgraph Mapping Example

```typescript
// subgraph handler — events should contain all data needed
export function handlePositionOpened(event: PositionOpened): void {
  let position = new Position(event.params.positionId.toString());
  position.owner = event.params.owner;
  position.market = event.params.market;
  position.isLong = event.params.isLong;
  position.size = event.params.size;
  position.collateral = event.params.collateral;
  position.entryPrice = event.params.entryPrice;
  position.openedAt = event.block.timestamp;
  position.openTxHash = event.transaction.hash;
  position.save();
}
```

## Anonymous Events

Anonymous events don't store the event signature as topic[0]. This allows 4 indexed parameters but events can't be filtered by name.

```solidity
// Saves ~375 gas (one fewer topic), but indexers can't filter by event name
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId, uint256 amount) anonymous;
```

Use anonymous events sparingly — only when the gas savings justify the indexing difficulty.

## Semantic Events for Protocol History

Emit enough data to reconstruct protocol history without reading storage.

```solidity
// A governance proposal should log everything needed for a governance dashboard
event ProposalCreated(
    uint256 indexed proposalId,
    address indexed proposer,
    address[] targets,
    uint256[] values,
    bytes[] calldatas,
    string description,
    uint256 startBlock,
    uint256 endBlock
);

event VoteCast(
    uint256 indexed proposalId,
    address indexed voter,
    uint8 support,      // 0=against, 1=for, 2=abstain
    uint256 weight,
    string reason
);
```

## Event Design Checklist

- [ ] Every state-changing function emits an event
- [ ] Key actors (user, token, pool) are indexed
- [ ] Amounts and computed values are in data (not indexed)
- [ ] Event names use past tense for actions
- [ ] Events contain all data needed by subgraph handlers
- [ ] No indexed strings/bytes (they're hashed and unreadable)
- [ ] Configuration change events include both old and new values
- [ ] Events documented with NatSpec
