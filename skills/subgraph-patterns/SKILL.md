---
name: subgraph-patterns
description: Use when building or maintaining The Graph subgraphs. Covers subgraph.yaml manifest, schema.graphql design, AssemblyScript mappings, event handlers, data source templates, testing with matchstick, deployment, and indexing optimization.
---

# The Graph Subgraph Patterns

## Project Structure

```
my-subgraph/
├── subgraph.yaml           # Manifest: data sources, event handlers
├── schema.graphql           # Entity definitions (GraphQL)
├── src/
│   └── mappings.ts          # Event handler logic (AssemblyScript)
├── tests/
│   └── mappings.test.ts     # Matchstick unit tests
├── abis/
│   └── MyContract.json      # Contract ABIs
└── networks.json            # Multi-network config
```

## Subgraph Manifest (subgraph.yaml)

```yaml
specVersion: 1.0.0
indexerHints:
  prune: auto
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: MyProtocol
    network: base
    source:
      address: "0xContractAddress"
      abi: MyProtocol
      startBlock: 12345678  # Block contract was deployed
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities:
        - Deposit
        - Withdrawal
        - User
      abis:
        - name: MyProtocol
          file: ./abis/MyProtocol.json
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: Deposit(indexed address,uint256,uint256)
          handler: handleDeposit
        - event: Withdrawal(indexed address,uint256)
          handler: handleWithdrawal
      file: ./src/mappings.ts
templates:
  - kind: ethereum
    name: Vault
    network: base
    source:
      abi: Vault
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities:
        - VaultDeposit
      abis:
        - name: Vault
          file: ./abis/Vault.json
      eventHandlers:
        - event: VaultDeposit(indexed address,uint256)
          handler: handleVaultDeposit
      file: ./src/vault-mappings.ts
```

## Schema Design (schema.graphql)

```graphql
type Protocol @entity {
  id: Bytes!                    # Use Bytes! for addresses
  totalDeposited: BigDecimal!
  totalUsers: BigInt!
  vaults: [Vault!]! @derivedFrom(field: "protocol")
}

type User @entity {
  id: Bytes!                    # user address
  deposits: [Deposit!]! @derivedFrom(field: "user")
  totalDeposited: BigDecimal!
  firstDepositAt: BigInt!
  lastActiveAt: BigInt!
}

type Vault @entity {
  id: Bytes!                    # vault address
  protocol: Protocol!
  asset: Bytes!
  totalAssets: BigDecimal!
  deposits: [Deposit!]! @derivedFrom(field: "vault")
  createdAt: BigInt!
  createdAtBlock: BigInt!
}

type Deposit @entity(immutable: true) {
  id: Bytes!                    # tx hash + log index
  user: User!
  vault: Vault!
  amount: BigDecimal!
  shares: BigInt!
  timestamp: BigInt!
  blockNumber: BigInt!
  transactionHash: Bytes!
}

type DailySnapshot @entity {
  id: String!                   # "YYYY-MM-DD"
  date: BigInt!
  totalDeposited: BigDecimal!
  depositCount: BigInt!
  uniqueUsers: BigInt!
}
```

Key schema patterns:
- Use `@entity(immutable: true)` for event logs (faster indexing)
- Use `@derivedFrom` for reverse lookups (no storage cost)
- Use `Bytes!` for addresses, `BigDecimal!` for token amounts
- Composite IDs for uniqueness: `txHash + logIndex`

## AssemblyScript Mappings

```typescript
import { BigDecimal, BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import { Deposit as DepositEvent, Withdrawal } from "../generated/MyProtocol/MyProtocol";
import { Deposit, User, Protocol, Vault } from "../generated/schema";
import { Vault as VaultTemplate } from "../generated/templates";

let ZERO_BD = BigDecimal.zero();
let ZERO_BI = BigInt.zero();
let ONE_BI = BigInt.fromI32(1);

function getOrCreateProtocol(): Protocol {
  let protocol = Protocol.load(Bytes.fromHexString("0x01"));
  if (protocol == null) {
    protocol = new Protocol(Bytes.fromHexString("0x01"));
    protocol.totalDeposited = ZERO_BD;
    protocol.totalUsers = ZERO_BI;
  }
  return protocol;
}

function getOrCreateUser(address: Address, timestamp: BigInt): User {
  let user = User.load(address);
  if (user == null) {
    user = new User(address);
    user.totalDeposited = ZERO_BD;
    user.firstDepositAt = timestamp;
    user.lastActiveAt = timestamp;

    let protocol = getOrCreateProtocol();
    protocol.totalUsers = protocol.totalUsers.plus(ONE_BI);
    protocol.save();
  }
  return user;
}

export function handleDeposit(event: DepositEvent): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp);
  let amount = event.params.amount.toBigDecimal().div(BigDecimal.fromString("1e18"));

  let deposit = new Deposit(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  deposit.user = user.id;
  deposit.vault = event.address;
  deposit.amount = amount;
  deposit.shares = event.params.shares;
  deposit.timestamp = event.block.timestamp;
  deposit.blockNumber = event.block.number;
  deposit.transactionHash = event.transaction.hash;
  deposit.save();

  user.totalDeposited = user.totalDeposited.plus(amount);
  user.lastActiveAt = event.block.timestamp;
  user.save();

  let protocol = getOrCreateProtocol();
  protocol.totalDeposited = protocol.totalDeposited.plus(amount);
  protocol.save();
}
```

## Data Source Templates

For dynamically created contracts (e.g., factory-deployed vaults):

```typescript
import { VaultCreated } from "../generated/Factory/Factory";
import { Vault as VaultTemplate } from "../generated/templates";
import { Vault } from "../generated/schema";

export function handleVaultCreated(event: VaultCreated): void {
  // Start indexing the new vault contract
  VaultTemplate.create(event.params.vault);

  let vault = new Vault(event.params.vault);
  vault.protocol = Bytes.fromHexString("0x01");
  vault.asset = event.params.asset;
  vault.totalAssets = BigDecimal.zero();
  vault.createdAt = event.block.timestamp;
  vault.createdAtBlock = event.block.number;
  vault.save();
}
```

## Testing with Matchstick

```typescript
import { assert, test, clearStore, beforeEach } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleDeposit } from "../src/mappings";
import { Deposit } from "../generated/MyProtocol/MyProtocol";

function createDepositEvent(user: string, amount: BigInt, shares: BigInt): Deposit {
  let event = changetype<Deposit>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(new ethereum.EventParam("user", ethereum.Value.fromAddress(Address.fromString(user))));
  event.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount)));
  event.parameters.push(new ethereum.EventParam("shares", ethereum.Value.fromUnsignedBigInt(shares)));
  return event;
}

beforeEach(() => { clearStore(); });

test("handleDeposit creates entities", () => {
  let event = createDepositEvent("0x0000000000000000000000000000000000000001", BigInt.fromString("1000000000000000000"), BigInt.fromString("1000000000000000000"));
  handleDeposit(event);
  assert.entityCount("Deposit", 1);
  assert.entityCount("User", 1);
});
```

## Deployment

```bash
# Build
graph codegen && graph build

# Deploy to Subgraph Studio
graph auth --studio $DEPLOY_KEY
graph deploy --studio my-subgraph

# Deploy to hosted service (deprecated, use Studio)
graph deploy --node https://api.thegraph.com/deploy/ my-org/my-subgraph
```

## Querying

```graphql
{
  deposits(first: 10, orderBy: timestamp, orderDirection: desc) {
    id
    user { id totalDeposited }
    amount
    timestamp
  }
  protocol(id: "0x01") {
    totalDeposited
    totalUsers
  }
}
```

Pagination for large datasets:

```graphql
{
  deposits(first: 1000, where: { id_gt: "0xlastId" }, orderBy: id) {
    id
    amount
  }
}
```

## Performance Tips

- Mark event entities as `@entity(immutable: true)` — 30-50% faster indexing
- Use `Bytes` over `String` for addresses and hashes
- Minimize `store.get` calls — batch reads where possible
- Set `startBlock` to contract deployment block (skip empty blocks)
- Use `indexerHints.prune: auto` to reduce storage
- Avoid expensive BigDecimal math in hot paths
