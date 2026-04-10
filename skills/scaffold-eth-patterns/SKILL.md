---
name: scaffold-eth-patterns
description: Use when building with Scaffold-ETH 2. Covers project structure, custom hooks (useScaffoldReadContract, useScaffoldWriteContract), debug page, deploying contracts, hot reload, and wagmi integration.
---

# Scaffold-ETH 2 Patterns

## Overview

Scaffold-ETH 2 is an open-source toolkit for rapid dApp prototyping. It combines Foundry (or Hardhat) + Next.js + wagmi + RainbowKit with custom hooks that simplify contract interaction. Key difference from raw wagmi: Scaffold hooks auto-detect ABIs from deployed contracts and wait for transaction confirmations.

## Quick Start

```bash
npx create-eth@latest my-dapp
cd my-dapp
yarn install
```

Start all services:

```bash
# Terminal 1: Local chain
yarn chain

# Terminal 2: Deploy contracts
yarn deploy

# Terminal 3: Start frontend
yarn start
```

## Project Structure

```
my-dapp/
├── packages/
│   ├── foundry/            # Smart contracts
│   │   ├── contracts/      # Solidity sources
│   │   ├── script/         # Deploy scripts
│   │   ├── test/           # Contract tests
│   │   └── foundry.toml
│   └── nextjs/             # Frontend
│       ├── app/            # Next.js app router pages
│       ├── components/     # React components
│       ├── contracts/      # Auto-generated contract data
│       ├── hooks/scaffold-eth/ # Custom hooks
│       ├── scaffold.config.ts  # Global config
│       └── utils/scaffold-eth/ # Utilities
├── package.json
└── yarn.lock
```

## Custom Hooks

### useScaffoldReadContract

Reads contract state with auto-detected ABI:

```tsx
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

function GreeterDisplay() {
  const { data: greeting, isLoading } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "greeting",
  });

  // With arguments
  const { data: balance } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "balanceOf",
    args: ["0xAddress"],
  });

  if (isLoading) return <p>Loading...</p>;
  return <p>Greeting: {greeting}</p>;
}
```

### useScaffoldWriteContract

Writes to contracts with automatic confirmation waiting:

```tsx
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

function SetGreeting() {
  const { writeContractAsync, isPending } = useScaffoldWriteContract("YourContract");

  const handleSubmit = async () => {
    try {
      // This waits for the tx to be confirmed (unlike raw wagmi)
      await writeContractAsync({
        functionName: "setGreeting",
        args: ["Hello from Scaffold-ETH!"],
        value: parseEther("0.01"), // Optional ETH value
      });
      console.log("Transaction confirmed!");
    } catch (e) {
      console.error("Transaction failed:", e);
    }
  };

  return (
    <button onClick={handleSubmit} disabled={isPending}>
      {isPending ? "Sending..." : "Set Greeting"}
    </button>
  );
}
```

### useScaffoldContract

Get a contract instance for direct interaction:

```tsx
import { useScaffoldContract } from "~~/hooks/scaffold-eth";

function ContractInfo() {
  const { data: contract } = useScaffoldContract({
    contractName: "YourContract",
  });

  // Access contract address and ABI
  console.log("Address:", contract?.address);
  console.log("ABI:", contract?.abi);
}
```

### useScaffoldEventHistory

Read historical events:

```tsx
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";

function EventLog() {
  const { data: events, isLoading } = useScaffoldEventHistory({
    contractName: "YourContract",
    eventName: "GreetingChange",
    fromBlock: 0n,
    watch: true,  // Live updates
  });

  return (
    <ul>
      {events?.map((event, i) => (
        <li key={i}>
          {event.args.greetingSetter}: {event.args.newGreeting}
        </li>
      ))}
    </ul>
  );
}
```

## Deploy Scripts

```solidity
// packages/foundry/script/Deploy.s.sol
pragma solidity ^0.8.20;

import {ScaffoldETHDeploy} from "./DeployHelpers.s.sol";
import {YourContract} from "../contracts/YourContract.sol";

contract DeployScript is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        YourContract yourContract = new YourContract(deployer);
        console.logString(string.concat("YourContract deployed at: ", vm.toString(address(yourContract))));
    }
}
```

```bash
# Deploy to local chain
yarn deploy

# Deploy to a specific network
yarn deploy --network base

# Reset deployments
yarn deploy --reset
```

## Debug Page

Scaffold-ETH includes a debug page at `/debug` that auto-generates a UI for all contract functions:

- Lists all read functions with call buttons
- Lists all write functions with input fields
- Displays events in real-time
- Shows contract address and balance
- Works with any deployed contract (auto-detected from ABI)

Access at: `http://localhost:3000/debug`

## Hot Reload

Scaffold-ETH watches for contract changes:

1. Edit Solidity in `packages/foundry/contracts/`
2. Run `yarn deploy` — recompiles and redeploys
3. Frontend auto-detects new ABI and addresses
4. Debug page updates immediately

The `deployedContracts.ts` file is auto-generated on each deploy.

## Scaffold-ETH vs Raw Wagmi

| Feature | Scaffold-ETH | Raw Wagmi |
|---------|-------------|-----------|
| ABI management | Auto-detected | Manual import |
| Tx confirmation | Auto-waits | Manual `useWaitForTransactionReceipt` |
| Contract address | Auto-resolved | Manual address |
| Debug UI | Built-in `/debug` | Build your own |
| Hot reload | Contracts auto-update | Manual config |
| Multi-chain | Config-based | Manual setup |
| Prototyping speed | Very fast | Moderate |
| Production flexibility | Limited | Full control |

### Key Difference: Transaction Confirmation

```tsx
// Scaffold-ETH: writeContractAsync waits for confirmation
await writeContractAsync({ functionName: "setGreeting", args: ["Hello"] });
// Transaction is CONFIRMED here

// Raw wagmi: need separate hook for confirmation
const { writeContract, data: hash } = useWriteContract();
const { isSuccess } = useWaitForTransactionReceipt({ hash });
// Must track isSuccess separately
```

## Configuration

```typescript
// packages/nextjs/scaffold.config.ts
import { defineConfig } from "~~/utils/scaffold-eth/defineConfig";

export default defineConfig({
  targetNetworks: [chains.foundry],  // Local dev
  // targetNetworks: [chains.base],  // Production
  pollingInterval: 30000,
  onlyLocalBurnerWallet: true,       // Dev only
  walletAutoConnect: true,
});
```

## Adding a New Contract

1. Create contract in `packages/foundry/contracts/`
2. Add to deploy script in `packages/foundry/script/Deploy.s.sol`
3. Run `yarn deploy`
4. Contract automatically appears in debug page and hooks

```solidity
// packages/foundry/contracts/Vault.sol
pragma solidity ^0.8.20;

contract Vault {
    mapping(address => uint256) public balances;

    event Deposited(address indexed user, uint256 amount);

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
    }
}
```

## Production Deployment

```bash
# Build frontend
yarn next:build

# Deploy contracts to production chain
yarn deploy --network base

# The frontend reads from the generated contract data
# Deploy frontend to Vercel, IPFS, etc.
```

## When to Use Scaffold-ETH

- **Use for**: Prototyping, hackathons, learning, MVPs, internal tools
- **Consider raw wagmi for**: Production dApps needing full customization, complex multi-contract UIs, or specific UX patterns
- **Migration path**: Start with Scaffold-ETH, extract components to raw wagmi as needed
