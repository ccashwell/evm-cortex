---
name: cctp-bridging
description: Use when building cross-chain USDC transfers, integrating with Circle's Cross-Chain Transfer Protocol (CCTP V2), or using Circle Gateway for unified balances. Covers the burn-attestation-mint flow, MessageTransmitter and TokenMessenger contracts, domain IDs for all chains, Gateway Wallet/Minter addresses, and Solidity integration patterns.
---

# CCTP Bridging — Circle Cross-Chain Transfer Protocol

## Architecture Overview

Cross-Chain Transfer Protocol (CCTP) enables **native** USDC transfers between chains through a burn-and-mint mechanism:

1. **Burn** — USDC is burned on the source chain via `TokenMessenger.depositForBurn()`
2. **Attest** — Circle's offchain attestation service observes the burn event and produces a signed attestation
3. **Mint** — Fresh USDC is minted on the destination chain via `MessageTransmitter.receiveMessage()`

This is **not** a lock-and-unlock bridge. USDC is destroyed on the source chain and recreated on the destination chain. There are no wrapped tokens, no liquidity pools, and no bridge TVL risk. Circle is the sole minter/burner.

### CCTP V2 Improvements

CCTP V2 (launched 2025) introduced:
- **Fast transfers** — configurable finality levels allowing ~8-20 second transfers
- **Hooks** — arbitrary calldata execution on the destination chain after mint
- **Per-message burn limits** — higher single-transfer caps
- **Additional chain support** — Unichain, Sei, Linea, and others

## Contract Addresses — CCTP V2

### TokenMessenger (initiate burns on source chain)

| Chain | Mainnet Address |
|-------|----------------|
| Ethereum | `0xBd3fa81B58Ba92a82136038B25aDec7066af3155` |
| Base | `0x1682Ae6375C4E4A97e4B583BC394c861A46D8962` |
| Arbitrum | `0x19330d10D9Cc8751218eaf51E8885D058642E08A` |
| Optimism | `0x2B4069517957735bE00ceE0fadAE88a26365528f` |
| Polygon PoS | `0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE` |
| Avalanche | `0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982` |

### MessageTransmitter (receive messages / mint on destination chain)

| Chain | Mainnet Address |
|-------|----------------|
| Ethereum | `0x0a992d191DEeC32aFe36203Ad87D7d289a738F81` |
| Base | `0xAD09780d193884d503182aD4F75D113B9B6a7c79` |
| Arbitrum | `0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca` |
| Optimism | `0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8` |
| Polygon PoS | `0xF3be9355363857F3e001be68856A2f96b4C39Ba9` |
| Avalanche | `0x8186359aF5F57FbB40c6b14A588d2A59C0C29880` |

### USDC Addresses (native Circle-issued)

| Chain | USDC Address |
|-------|-------------|
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Optimism | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |
| Polygon PoS | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Avalanche | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |

> **Warning:** Bridged USDC variants (USDC.e on Arbitrum/Avalanche/Polygon) are NOT the same as native USDC. CCTP only works with native Circle-issued USDC.

## Domain IDs

CCTP uses its own domain ID system, distinct from EVM chain IDs.

| Chain | Domain ID | Chain ID |
|-------|-----------|----------|
| Ethereum | 0 | 1 |
| Avalanche | 1 | 43114 |
| Optimism | 2 | 10 |
| Arbitrum | 3 | 42161 |
| Noble (Cosmos) | 4 | — |
| Solana | 5 | — |
| Base | 6 | 8453 |
| Polygon PoS | 7 | 137 |
| Sui | 8 | — |
| Unichain | 10 | 130 |

```solidity
library CCTPDomains {
    uint32 internal constant ETHEREUM = 0;
    uint32 internal constant AVALANCHE = 1;
    uint32 internal constant OPTIMISM = 2;
    uint32 internal constant ARBITRUM = 3;
    uint32 internal constant NOBLE = 4;
    uint32 internal constant SOLANA = 5;
    uint32 internal constant BASE = 6;
    uint32 internal constant POLYGON = 7;
    uint32 internal constant SUI = 8;
    uint32 internal constant UNICHAIN = 10;
}
```

## Core Interfaces

### ITokenMessenger

```solidity
interface ITokenMessenger {
    /// @notice Deposits and burns tokens for a cross-chain transfer
    /// @param amount Amount of tokens to burn (6 decimals for USDC)
    /// @param destinationDomain CCTP domain ID of the destination chain
    /// @param mintRecipient Address on destination chain (left-padded bytes32)
    /// @param burnToken Address of the token to burn on the source chain
    /// @return nonce Unique nonce for this message
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 nonce);

    /// @notice Deposits and burns tokens with a caller restriction on the destination
    /// @dev Only `destinationCaller` can call receiveMessage for this transfer
    /// @param amount Amount of tokens to burn
    /// @param destinationDomain CCTP domain ID of the destination chain
    /// @param mintRecipient Address on destination chain (left-padded bytes32)
    /// @param burnToken Address of the token to burn
    /// @param destinationCaller Address permitted to relay on destination (bytes32)
    /// @return nonce Unique nonce for this message
    function depositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    ) external returns (uint64 nonce);
}
```

### IMessageTransmitter

```solidity
interface IMessageTransmitter {
    /// @notice Receives a message and triggers mint on the destination chain
    /// @param message Raw message bytes from the source chain burn event
    /// @param attestation Circle attestation service signature over the message
    /// @return success Whether the message was successfully received
    function receiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool success);

    /// @notice Receives a message that can only be relayed by a specific caller
    /// @dev Used with depositForBurnWithCaller for restricted relay
    function receiveMessageWithCaller(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool success);
}
```

## Solidity Integration — Sending USDC Cross-Chain

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ITokenMessenger {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 nonce);

    function depositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    ) external returns (uint64 nonce);
}

/// @title CCTPSender
/// @notice Sends USDC cross-chain via Circle's CCTP V2
/// @dev Wraps TokenMessenger with SafeERC20 and address encoding
contract CCTPSender {
    using SafeERC20 for IERC20;

    ITokenMessenger public immutable TOKEN_MESSENGER;
    IERC20 public immutable USDC;

    error ZeroAmount();
    error ZeroAddress();

    event CCTPBurnInitiated(
        uint64 indexed nonce,
        uint32 indexed destinationDomain,
        address indexed recipient,
        uint256 amount
    );

    constructor(address tokenMessenger_, address usdc_) {
        if (tokenMessenger_ == address(0) || usdc_ == address(0)) revert ZeroAddress();
        TOKEN_MESSENGER = ITokenMessenger(tokenMessenger_);
        USDC = IERC20(usdc_);
    }

    /// @notice Burns USDC on this chain and triggers a mint on the destination chain
    /// @param amount Amount of USDC to send (6 decimals)
    /// @param destinationDomain CCTP domain ID of the target chain
    /// @param recipient EVM address that will receive USDC on the destination chain
    /// @return nonce The message nonce for tracking attestation status
    function sendUSDC(
        uint256 amount,
        uint32 destinationDomain,
        address recipient
    ) external returns (uint64 nonce) {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        USDC.safeTransferFrom(msg.sender, address(this), amount);
        USDC.forceApprove(address(TOKEN_MESSENGER), amount);

        bytes32 mintRecipient = _addressToBytes32(recipient);

        nonce = TOKEN_MESSENGER.depositForBurn(
            amount,
            destinationDomain,
            mintRecipient,
            address(USDC)
        );

        emit CCTPBurnInitiated(nonce, destinationDomain, recipient, amount);
    }

    /// @notice Burns USDC with a restricted relayer on the destination chain
    /// @dev Only `destinationCaller` can complete the transfer on the other side
    /// @param amount Amount of USDC to send (6 decimals)
    /// @param destinationDomain CCTP domain ID of the target chain
    /// @param recipient EVM address that will receive USDC on the destination chain
    /// @param destinationCaller Address allowed to call receiveMessage on destination
    /// @return nonce The message nonce for tracking attestation status
    function sendUSDCWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        address recipient,
        address destinationCaller
    ) external returns (uint64 nonce) {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0) || destinationCaller == address(0)) revert ZeroAddress();

        USDC.safeTransferFrom(msg.sender, address(this), amount);
        USDC.forceApprove(address(TOKEN_MESSENGER), amount);

        nonce = TOKEN_MESSENGER.depositForBurnWithCaller(
            amount,
            destinationDomain,
            _addressToBytes32(recipient),
            address(USDC),
            _addressToBytes32(destinationCaller)
        );

        emit CCTPBurnInitiated(nonce, destinationDomain, recipient, amount);
    }

    /// @dev Converts an EVM address to a left-padded bytes32 for CCTP
    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
```

## Solidity Integration — Receiving USDC Cross-Chain

The destination side calls `MessageTransmitter.receiveMessage()` with the attestation obtained from Circle's API. This is typically done by an offchain relayer, but can also be called from a contract:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMessageTransmitter {
    function receiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool success);
}

/// @title CCTPReceiver
/// @notice Relays attested CCTP messages to complete cross-chain USDC transfers
contract CCTPReceiver {
    IMessageTransmitter public immutable MESSAGE_TRANSMITTER;

    error ReceiveFailed();

    event CCTPMessageRelayed(bytes32 indexed messageHash);

    constructor(address messageTransmitter_) {
        MESSAGE_TRANSMITTER = IMessageTransmitter(messageTransmitter_);
    }

    /// @notice Relays an attested CCTP message to mint USDC to the original recipient
    /// @param message Raw message bytes emitted during the source chain burn
    /// @param attestation Signed attestation from Circle's attestation service
    function relay(bytes calldata message, bytes calldata attestation) external {
        bool success = MESSAGE_TRANSMITTER.receiveMessage(message, attestation);
        if (!success) revert ReceiveFailed();

        emit CCTPMessageRelayed(keccak256(message));
    }
}
```

## Attestation Service

After burning USDC on the source chain, poll Circle's attestation API until the attestation is ready.

### Endpoints

```
Mainnet:  https://iris-api-v2.circle.com/v2/attestations/{messageHash}
Testnet:  https://iris-api-v2-sandbox.circle.com/v2/attestations/{messageHash}
```

### Computing the Message Hash

The `messageHash` is the keccak256 of the raw `message` bytes emitted in the `MessageSent` event on the source chain:

```solidity
event MessageSent(bytes message);

// To compute the hash offchain:
// messageHash = keccak256(message)
```

### Polling Pattern

```typescript
async function waitForAttestation(messageHash: string): Promise<string> {
  const endpoint = `https://iris-api-v2.circle.com/v2/attestations/${messageHash}`;

  while (true) {
    const res = await fetch(endpoint);
    const data = await res.json();

    if (data.status === "complete") {
      return data.attestation;
    }

    // Poll every 5 seconds; fast finality transfers resolve in ~10-20s
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
```

### Response Shape

```json
{
  "attestation": "0x...",
  "status": "complete"
}
```

Status values: `"pending_confirmations"` → `"complete"`. Once complete, the `attestation` hex string is passed to `receiveMessage()`.

## Circle Gateway — Unified USDC Balance

Gateway provides a **unified USDC balance** across all supported chains with near-instant (<500ms) transfers. Instead of burning and waiting for attestation per transfer, you pre-fund a Gateway Wallet and create burn intents signed with EIP-712.

### Gateway Contract Addresses

These addresses are the **same on every supported EVM chain**:

| Contract | Mainnet | Testnet |
|----------|---------|---------|
| Gateway Wallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway Minter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |

### Gateway Flow

```
┌──────────────┐     ┌───────────────┐     ┌─────────────────┐
│ 1. Deposit   │────▶│ 2. Burn       │────▶│ 3. Mint         │
│ USDC to      │     │ Intent        │     │ on destination   │
│ Gateway      │     │ (EIP-712 sig) │     │ via Gateway API  │
│ Wallet       │     │               │     │                  │
└──────────────┘     └───────────────┘     └─────────────────┘
```

1. **Deposit** — Transfer USDC to the Gateway Wallet address on any supported chain
2. **Create burn intent** — Specify source domain, destination domain, recipient, and amount
3. **Sign** — Sign the intent using EIP-712 structured data
4. **Submit** — Send the signed intent to Gateway's API
5. **Receive attestation** — Gateway returns an attestation almost immediately
6. **Mint** — Call `gatewayMint()` on the destination chain with the attestation

### Solidity — Depositing to Gateway

```solidity
/// @notice Deposits USDC into the Gateway Wallet to fund the unified balance
/// @dev Simply transfers USDC to the well-known Gateway Wallet address
/// @param amount Amount of USDC to deposit (6 decimals)
function depositToGateway(uint256 amount) external {
    USDC.safeTransferFrom(msg.sender, GATEWAY_WALLET, amount);
    emit GatewayDeposit(msg.sender, amount);
}
```

### EIP-712 Burn Intent

```solidity
bytes32 constant BURN_INTENT_TYPEHASH = keccak256(
    "BurnIntent(uint32 sourceDomain,uint32 destinationDomain,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"
);

struct BurnIntent {
    uint32 sourceDomain;
    uint32 destinationDomain;
    address recipient;
    uint256 amount;
    uint256 nonce;
    uint256 deadline;
}
```

## CCTP vs Gateway — Decision Matrix

| Criteria | CCTP (direct) | Gateway |
|----------|---------------|---------|
| Latency | 8–20 seconds (fast finality) | <500ms |
| Pre-funding required | No | Yes (deposit to Gateway Wallet) |
| Unified balance | No (per-chain) | Yes (single balance, any chain) |
| Best for | One-off or infrequent transfers | High-frequency, multi-chain apps |
| Contract complexity | Lower (two calls) | Higher (EIP-712, API integration) |
| Minimum viable integration | 1 contract + relayer | Offchain service + Gateway API |
| Cost | Gas on source + destination | Gas on source + destination + Gateway fee |

**Use CCTP when:**
- Building a simple bridge UI or one-time migration tool
- Users initiate transfers manually and can wait ~15 seconds
- You want minimal offchain infrastructure

**Use Gateway when:**
- Your protocol operates across multiple chains simultaneously
- You need sub-second settlement for user experience
- You're building a payment system, DEX aggregator, or cross-chain vault

## CCTP V2 Hooks — Post-Mint Execution

CCTP V2 supports attaching arbitrary calldata that executes on the destination chain after USDC is minted. This enables atomic cross-chain operations.

```solidity
interface ITokenMessengerV2 {
    /// @notice Burns tokens and sends a message with a hook to execute on destination
    /// @param amount Amount to burn
    /// @param destinationDomain Destination CCTP domain
    /// @param mintRecipient Recipient on destination
    /// @param burnToken Token to burn
    /// @param destinationCaller Restricted relayer (bytes32(0) for any)
    /// @param maxFee Maximum fee for fast transfer (set 0 for standard)
    /// @param hookData Calldata to execute on the destination after mint
    /// @return nonce Message nonce
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        bytes calldata hookData
    ) external returns (uint64 nonce);
}
```

### Hook Example — Cross-Chain Deposit into a Vault

```solidity
// Encode a vault deposit call as hook data
bytes memory hookData = abi.encodeWithSelector(
    IVault.deposit.selector,
    amount,
    recipient
);

// USDC is minted to mintRecipient, then hookData is executed
// mintRecipient should be a contract that approves the vault and calls deposit
tokenMessenger.depositForBurnWithHook(
    amount,
    CCTPDomains.BASE,
    _addressToBytes32(hookReceiver),
    address(usdc),
    bytes32(0),
    0,
    hookData
);
```

## Bridge Kit SDK (TypeScript — Offchain)

For applications that need end-to-end CCTP without managing attestation polling manually:

```typescript
import { BridgeKit } from "@circle-fin/bridge-kit";

const kit = new BridgeKit({ apiKey: process.env.CIRCLE_API_KEY });

const transfer = await kit.bridge({
  sourceChain: "ethereum",
  destinationChain: "base",
  amount: "1000000", // 1 USDC (6 decimals)
  recipient: "0x...",
});

// kit.bridge() handles: approve → burn → poll attestation → receiveMessage
console.log(`Transfer complete: ${transfer.destinationTxHash}`);
```

## Testing with Foundry

### Fork Test — Source Chain Burn

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITokenMessenger {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 nonce);
}

contract CCTPForkTest is Test {
    ITokenMessenger constant MESSENGER =
        ITokenMessenger(0xBd3fa81B58Ba92a82136038B25aDec7066af3155);
    IERC20 constant USDC =
        IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    address sender = makeAddr("sender");

    function setUp() public {
        vm.createSelectFork("mainnet");
        deal(address(USDC), sender, 1000e6);
    }

    function test_depositForBurn_toBase() public {
        vm.startPrank(sender);

        USDC.approve(address(MESSENGER), 100e6);
        bytes32 recipient = bytes32(uint256(uint160(sender)));

        uint64 nonce = MESSENGER.depositForBurn(
            100e6,
            6, // Base domain
            recipient,
            address(USDC)
        );

        assertGt(nonce, 0, "nonce should be non-zero");
        assertEq(USDC.balanceOf(sender), 900e6, "100 USDC should be burned");

        vm.stopPrank();
    }

    function test_depositForBurn_revertsOnZeroAmount() public {
        vm.startPrank(sender);
        USDC.approve(address(MESSENGER), 0);

        vm.expectRevert();
        MESSENGER.depositForBurn(
            0,
            6,
            bytes32(uint256(uint160(sender))),
            address(USDC)
        );
        vm.stopPrank();
    }

    function test_depositForBurn_revertsWithoutApproval() public {
        vm.prank(sender);
        vm.expectRevert();
        MESSENGER.depositForBurn(
            100e6,
            6,
            bytes32(uint256(uint160(sender))),
            address(USDC)
        );
    }
}
```

### Unit Test — CCTPSender Wrapper

```solidity
contract CCTPSenderTest is Test {
    CCTPSender sender;
    address mockMessenger;
    address mockUSDC;

    function setUp() public {
        mockMessenger = makeAddr("messenger");
        mockUSDC = makeAddr("usdc");
        sender = new CCTPSender(mockMessenger, mockUSDC);
    }

    function test_constructor_setsImmutables() public view {
        assertEq(address(sender.TOKEN_MESSENGER()), mockMessenger);
        assertEq(address(sender.USDC()), mockUSDC);
    }

    function test_sendUSDC_revertsOnZeroAmount() public {
        vm.expectRevert(CCTPSender.ZeroAmount.selector);
        sender.sendUSDC(0, 6, makeAddr("recipient"));
    }

    function test_sendUSDC_revertsOnZeroRecipient() public {
        vm.expectRevert(CCTPSender.ZeroAddress.selector);
        sender.sendUSDC(100e6, 6, address(0));
    }
}
```

## Security Rules

1. **Verify domain IDs** — Always validate that the domain ID maps to the intended chain. A wrong domain ID sends USDC to the wrong chain irreversibly.
2. **Use `depositForBurnWithCaller`** — When your protocol has a dedicated relayer, restrict who can call `receiveMessage` on the destination to prevent front-running.
3. **Validate USDC addresses** — CCTP only works with native Circle-issued USDC. Bridged variants (USDC.e) will cause the burn to revert.
4. **Handle attestation failures** — The attestation service can be temporarily unavailable. Implement retry logic with exponential backoff.
5. **Never hardcode private keys** — Use environment variables or hardware wallets for signing Gateway burn intents.
6. **Validate recipient encoding** — EVM addresses must be left-padded to bytes32 via `bytes32(uint256(uint160(addr)))`. Incorrect encoding burns USDC to an unrecoverable address.
7. **Respect burn limits** — CCTP has per-message burn limits that vary by chain. Check `TokenMinter.burnLimitsPerMessage(token)` before initiating large transfers.
8. **Gateway EIP-712** — Never modify the Gateway domain separator or type definitions. Malformed signatures will be rejected and funds remain locked in the Gateway Wallet until a valid intent is submitted.
9. **Reentrancy on hooks** — If using CCTP V2 hooks, the hook receiver contract must be `nonReentrant`. The hook executes in the same transaction as the mint.
10. **Nonce tracking** — Store the `nonce` returned by `depositForBurn` for reconciliation and attestation lookups.

## Burn Limit Reference

Check onchain before large transfers:

```solidity
interface ITokenMinter {
    function burnLimitsPerMessage(address token) external view returns (uint256);
}

// Ethereum mainnet TokenMinter
ITokenMinter minter = ITokenMinter(0xc4922d64a24675E16e1586e3e3Aa56C06fABe907);
uint256 limit = minter.burnLimitsPerMessage(USDC_ADDRESS);
```

Typical mainnet limits (subject to Circle governance):
- Ethereum: 40,000,000 USDC (40M)
- Other chains: varies, check onchain

## Integration Checklist

### CCTP Direct Integration

- [ ] Using native USDC address (not bridged USDC.e)
- [ ] Domain IDs verified against the CCTP domain table, not EVM chain IDs
- [ ] `SafeERC20.forceApprove()` used for USDC approval to TokenMessenger
- [ ] Recipient address correctly encoded as left-padded bytes32
- [ ] Burn amount checked against `burnLimitsPerMessage` for large transfers
- [ ] `depositForBurnWithCaller` used when a dedicated relayer exists
- [ ] Attestation polling implemented with retry and exponential backoff
- [ ] `receiveMessage` call wrapped with error handling
- [ ] Events emitted on both burn initiation and message relay
- [ ] Nonce stored for reconciliation and status tracking
- [ ] Fork tests pass against mainnet TokenMessenger and MessageTransmitter

### Gateway Integration

- [ ] USDC deposited to correct Gateway Wallet address (same on all chains)
- [ ] EIP-712 domain separator matches Gateway specification exactly
- [ ] Burn intent nonce managed to prevent replay
- [ ] Deadline set on burn intents to bound validity window
- [ ] Gateway API error responses handled (rate limits, invalid intents)
- [ ] Unified balance reconciled with actual Gateway Wallet deposits
- [ ] `gatewayMint` attestation verified before relying on destination mint

### CCTP V2 Hooks

- [ ] Hook receiver contract deployed on the destination chain
- [ ] Hook receiver implements `nonReentrant` protection
- [ ] Hook calldata ABI-encoded correctly for the destination function
- [ ] `mintRecipient` set to the hook receiver contract (not the end user)
- [ ] Hook receiver approves downstream contracts (vault, DEX) after receiving USDC
- [ ] Failure in hook execution does not lock minted USDC (fallback to simple transfer)

### Testing

- [ ] Fork test confirms `depositForBurn` succeeds on mainnet state
- [ ] Fork test confirms burn reduces sender USDC balance by exact amount
- [ ] Unit tests cover zero amount, zero address, and missing approval reverts
- [ ] Integration test covers full burn → attest → mint flow on testnet
- [ ] Gas snapshot captured for `sendUSDC` and `relay` functions
