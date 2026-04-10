---
name: wallet-integration
description: Use when integrating wallets into dApps. Covers WalletConnect, injected providers, EIP-1193, account abstraction (EIP-4337, EIP-7702), Safe SDK, multi-sig interaction, hardware wallets, and network switching.
---

# Wallet Integration Patterns

## EIP-1193 Provider Standard

All wallets expose a standard provider interface:

```typescript
interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

// Common methods:
await provider.request({ method: 'eth_requestAccounts' });
await provider.request({ method: 'eth_chainId' });
await provider.request({ method: 'personal_sign', params: [message, address] });
await provider.request({ method: 'eth_sendTransaction', params: [txParams] });
```

## Wallet Connection with RainbowKit

```tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';

function Header() {
  return (
    <nav>
      <ConnectButton
        showBalance={true}
        chainStatus="icon"
        accountStatus="address"
      />
    </nav>
  );
}
```

Custom connect button:

```tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';

function CustomConnect() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;
        if (!connected) {
          return <button onClick={openConnectModal}>Connect Wallet</button>;
        }
        if (chain.unsupported) {
          return <button onClick={openChainModal}>Wrong Network</button>;
        }
        return (
          <div>
            <button onClick={openChainModal}>{chain.name}</button>
            <button onClick={openAccountModal}>{account.displayName}</button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
```

## WalletConnect v2

```typescript
import { walletConnect } from 'wagmi/connectors';

const wcConnector = walletConnect({
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
  metadata: {
    name: 'My dApp',
    description: 'A great dApp',
    url: 'https://mydapp.xyz',
    icons: ['https://mydapp.xyz/icon.png'],
  },
  showQrModal: true,
});
```

## Injected Wallet Detection

```typescript
import { injected } from 'wagmi/connectors';
import { useConnect } from 'wagmi';

function WalletList() {
  const { connectors, connect } = useConnect();

  return (
    <div>
      {connectors.map((connector) => (
        <button key={connector.uid} onClick={() => connect({ connector })}>
          {connector.name}
        </button>
      ))}
    </div>
  );
}
```

## Network Switching (EIP-3085)

```typescript
import { useSwitchChain } from 'wagmi';

function NetworkSwitch() {
  const { chains, switchChain, isPending } = useSwitchChain();

  return (
    <div>
      {chains.map((chain) => (
        <button
          key={chain.id}
          disabled={isPending}
          onClick={() => switchChain({ chainId: chain.id })}
        >
          {chain.name}
        </button>
      ))}
    </div>
  );
}

// Add custom chain if not recognized
async function addChain(provider: EIP1193Provider) {
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: '0x2105',  // Base (8453)
      chainName: 'Base',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    }],
  });
}
```

## Account Abstraction (EIP-4337)

```typescript
import { createSmartAccountClient } from 'permissionless';
import { signerToSimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const publicClient = createPublicClient({ chain: base, transport: http() });

const pimlicoClient = createPimlicoClient({
  transport: http(`https://api.pimlico.io/v2/base/rpc?apikey=${PIMLICO_KEY}`),
  entryPoint: { address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032', version: '0.7' },
});

const smartAccount = await signerToSimpleSmartAccount(publicClient, {
  signer: walletClientSigner,
  entryPoint: { address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032', version: '0.7' },
});

const smartAccountClient = createSmartAccountClient({
  account: smartAccount,
  chain: base,
  bundlerTransport: http(`https://api.pimlico.io/v2/base/rpc?apikey=${PIMLICO_KEY}`),
  paymaster: pimlicoClient,
});

// Gasless transaction
const hash = await smartAccountClient.sendTransaction({
  to: '0xRecipient',
  value: 0n,
  data: '0x...',
});
```

## Safe (Multi-Sig) Integration

```typescript
import SafeApiKit from '@safe-global/api-kit';
import Safe from '@safe-global/protocol-kit';

const apiKit = new SafeApiKit({ chainId: 8453n });

// Propose a transaction
const safeSdk = await Safe.init({
  provider: rpcUrl,
  signer: signerPrivateKey,
  safeAddress: '0xSafeAddress',
});

const safeTransaction = await safeSdk.createTransaction({
  transactions: [{
    to: '0xToken',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, amount] }),
    value: '0',
  }],
});

const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
const signature = await safeSdk.signHash(safeTxHash);

await apiKit.proposeTransaction({
  safeAddress: '0xSafeAddress',
  safeTransactionData: safeTransaction.data,
  safeTxHash,
  senderAddress: signerAddress,
  senderSignature: signature.data,
});
```

## Connection State Management

```tsx
import { useAccount, useBalance, useDisconnect } from 'wagmi';

function WalletStatus() {
  const { address, isConnected, chain, connector } = useAccount();
  const { data: balance } = useBalance({ address });
  const { disconnect } = useDisconnect();

  if (!isConnected) return <p>Not connected</p>;

  return (
    <div>
      <p>Address: {address}</p>
      <p>Chain: {chain?.name}</p>
      <p>Wallet: {connector?.name}</p>
      <p>Balance: {balance?.formatted} {balance?.symbol}</p>
      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  );
}
```

## Wallet Connection Flow

1. User clicks "Connect Wallet"
2. Modal shows available wallets (injected, WalletConnect, Coinbase)
3. User selects wallet → `eth_requestAccounts`
4. Check chain → `wallet_switchEthereumChain` if wrong
5. Store connection (wagmi handles persistence)
6. Listen for `accountsChanged` and `chainChanged` events
7. Handle disconnection gracefully

## Security Considerations

- Validate `chainId` before every transaction
- Don't trust `msg.sender` from wallet (user can spoof in dApp context)
- Sign typed data (EIP-712) instead of raw messages when possible
- Display human-readable transaction details before signing
- Handle rejected transactions gracefully (user cancelled)
- Clear sensitive state on disconnect
- Validate addresses before sending (checksummed, not zero)
