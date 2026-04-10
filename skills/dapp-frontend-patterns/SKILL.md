---
name: dapp-frontend-patterns
description: Use when building dApp frontends with wagmi v2 and viem. Covers useReadContract, useWriteContract, useSimulateContract, useWaitForTransactionReceipt, wallet connection (RainbowKit), chain switching, and ENS resolution.
---

# dApp Frontend Patterns

## Stack Overview

- **viem**: Low-level TypeScript library for Ethereum (replaces ethers.js)
- **wagmi v2**: React hooks for Ethereum (built on viem + TanStack Query)
- **RainbowKit**: Wallet connection UI component

## Project Setup

```bash
npm create wagmi@latest my-dapp
# Select: Next.js, RainbowKit

# Or add to existing project:
npm install wagmi viem @tanstack/react-query @rainbow-me/rainbowkit
```

## Wagmi Config

```typescript
import { http, createConfig } from 'wagmi';
import { base, mainnet, optimism } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

export const config = getDefaultConfig({
  appName: 'My dApp',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!, // WalletConnect
  chains: [base, mainnet, optimism],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC),
    [optimism.id]: http(process.env.NEXT_PUBLIC_OP_RPC),
  },
});
```

## Provider Setup

```tsx
'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { config } from './config';
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

## Reading Contract Data

```tsx
import { useReadContract, useReadContracts } from 'wagmi';
import { formatEther, formatUnits } from 'viem';

const tokenAbi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const;

function TokenBalance({ address, token }: { address: `0x${string}`; token: `0x${string}` }) {
  const { data: balance, isLoading } = useReadContract({
    address: token,
    abi: tokenAbi,
    functionName: 'balanceOf',
    args: [address],
  });

  // Batch multiple reads in one call
  const { data: tokenInfo } = useReadContracts({
    contracts: [
      { address: token, abi: tokenAbi, functionName: 'symbol' },
      { address: token, abi: tokenAbi, functionName: 'decimals' },
    ],
  });

  if (isLoading) return <span>Loading...</span>;

  const symbol = tokenInfo?.[0]?.result ?? '';
  const decimals = tokenInfo?.[1]?.result ?? 18;

  return (
    <span>
      {balance != null ? formatUnits(balance, decimals) : '0'} {symbol}
    </span>
  );
}
```

## Writing to Contracts (Simulate + Write + Wait)

```tsx
import { useSimulateContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';

function DepositButton({ amount }: { amount: string }) {
  // 1. Simulate (dry run) to check for revert
  const { data: simData, error: simError } = useSimulateContract({
    address: '0xVault',
    abi: vaultAbi,
    functionName: 'deposit',
    args: [parseEther(amount)],
  });

  // 2. Write (send transaction)
  const { writeContract, data: txHash, isPending } = useWriteContract();

  // 3. Wait for confirmation
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  return (
    <div>
      {simError && <p>Error: {simError.message}</p>}
      <button
        disabled={!simData?.request || isPending || isConfirming}
        onClick={() => writeContract(simData!.request)}
      >
        {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : 'Deposit'}
      </button>
      {isSuccess && <p>Deposit confirmed!</p>}
    </div>
  );
}
```

## Approval + Action Pattern

```tsx
function ApproveAndDeposit({ token, vault, amount }: Props) {
  const { address } = useAccount();

  const { data: allowance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address!, vault],
  });

  const needsApproval = allowance != null && allowance < amount;

  const { data: approveSim } = useSimulateContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [vault, amount],
    query: { enabled: needsApproval },
  });

  const { data: depositSim } = useSimulateContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'deposit',
    args: [amount],
    query: { enabled: !needsApproval },
  });

  const { writeContract, data: txHash } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (needsApproval) {
    return (
      <button
        disabled={!approveSim?.request}
        onClick={() => writeContract(approveSim!.request)}
      >
        Approve
      </button>
    );
  }

  return (
    <button
      disabled={!depositSim?.request}
      onClick={() => writeContract(depositSim!.request)}
    >
      Deposit
    </button>
  );
}
```

## Chain Switching

```tsx
import { useSwitchChain, useChainId } from 'wagmi';
import { base, optimism } from 'wagmi/chains';

function ChainSwitcher() {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  return (
    <div>
      <p>Current chain: {chainId}</p>
      <button onClick={() => switchChain({ chainId: base.id })}>Switch to Base</button>
      <button onClick={() => switchChain({ chainId: optimism.id })}>Switch to Optimism</button>
    </div>
  );
}
```

## ENS Resolution

```tsx
import { useEnsName, useEnsAddress, useEnsAvatar } from 'wagmi';

function ENSProfile({ address }: { address: `0x${string}` }) {
  const { data: name } = useEnsName({ address });
  const { data: avatar } = useEnsAvatar({ name: name ?? undefined });

  return (
    <div>
      {avatar && <img src={avatar} alt="ENS avatar" />}
      <span>{name ?? `${address.slice(0, 6)}...${address.slice(-4)}`}</span>
    </div>
  );
}
```

## viem Direct Usage (Non-React)

```typescript
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

const publicClient = createPublicClient({ chain: base, transport: http() });

const balance = await publicClient.readContract({
  address: '0xToken',
  abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
  functionName: 'balanceOf',
  args: ['0xAddress'],
});

const logs = await publicClient.getLogs({
  address: '0xContract',
  event: parseAbi(['event Transfer(address indexed, address indexed, uint256)'])[0],
  fromBlock: 'earliest',
  toBlock: 'latest',
});
```

## Best Practices

- Always simulate before writing (`useSimulateContract` → `useWriteContract`)
- Use `useWaitForTransactionReceipt` for confirmation — don't assume tx is mined
- Batch reads with `useReadContracts` to reduce RPC calls
- Handle all states: loading, error, success, pending confirmation
- Use `parseAbi` for inline ABI definitions (type-safe)
- Set `query.enabled` to conditionally run hooks
- Display tx hash link to block explorer while waiting for confirmation
