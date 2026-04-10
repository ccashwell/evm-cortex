---
name: erc7702-patterns
description: Use when building with EIP-7702 account abstraction. Covers EOA smart contract delegation, authorization tuples, transaction batching, sponsored transactions, session keys, and dApp integration. Live since Pectra (May 2025).
---

# EIP-7702 Account Abstraction Patterns

## Overview

EIP-7702 (shipped with Pectra, May 2025) lets EOAs temporarily delegate to smart contract code. The EOA's address gains smart contract capabilities without deploying a new account. Unlike EIP-4337, there's no separate EntryPoint or bundler infrastructure.

## How It Works

A new transaction type (0x04) includes authorization tuples that set the EOA's code to point at a delegation contract:

```
authorization_list: [{ chain_id, address, nonce, y_parity, r, s }]
```

When the tx executes, the EOA's code is set to `0xef0100 || address` (a delegation designator pointing to the implementation contract). All calls to the EOA now execute the implementation's code in the EOA's context.

## Authorization Tuple

```solidity
struct Authorization {
    uint256 chainId;   // 0 = valid on any chain
    address delegate;  // implementation contract
    uint64 nonce;      // EOA's current nonce
    uint8 yParity;
    bytes32 r;
    bytes32 s;
}
```

Sign offchain with the EOA's private key:

```typescript
import { createWalletClient, http, parseEther } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { eip7702Actions } from 'viem/experimental';

const account = privateKeyToAccount('0x...');
const client = createWalletClient({
  account,
  chain: mainnet,
  transport: http(),
}).extend(eip7702Actions());

const authorization = await client.signAuthorization({
  contractAddress: '0xDelegateContract...',
});

const hash = await client.sendTransaction({
  authorizationList: [authorization],
  to: account.address,
  data: encodeFunctionData({ ... }),
});
```

## Delegation Contract (Smart Account)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

contract SmartAccount {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice Execute a batch of calls from the delegating EOA.
    /// Only the EOA itself can invoke (msg.sender == address(this)).
    function execute(Call[] calldata calls) external payable {
        require(msg.sender == address(this), "Only self");
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            require(ok, string(ret));
        }
    }
}
```

## Transaction Batching

Users can batch multiple actions into one transaction:

```typescript
const calls = [
  { target: tokenAddress, value: 0n, data: approveCalldata },
  { target: routerAddress, value: 0n, data: swapCalldata },
  { target: stakingAddress, value: 0n, data: stakeCalldata },
];

const hash = await client.sendTransaction({
  authorizationList: [authorization],
  to: account.address,
  data: encodeFunctionData({
    abi: smartAccountAbi,
    functionName: 'execute',
    args: [calls],
  }),
});
```

## Sponsored Transactions

A relayer can submit a 7702 tx on behalf of the user. The user signs the authorization, the relayer pays gas:

```solidity
contract SponsoredAccount {
    mapping(address => bool) public sponsors;

    function executeSponsored(
        Call[] calldata calls,
        address sponsor,
        bytes calldata sponsorSig
    ) external {
        require(sponsors[sponsor] || msg.sender == address(this), "Unauthorized");
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok,) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            require(ok, "Call failed");
        }
    }
}
```

## Session Keys

Delegate limited permissions to a session key for a period:

```solidity
contract SessionKeyAccount {
    struct SessionKey {
        address key;
        uint48 validAfter;
        uint48 validUntil;
        address[] allowedTargets;
    }

    mapping(bytes32 => bool) public sessionKeys;

    function addSessionKey(SessionKey calldata sk) external {
        require(msg.sender == address(this), "Only self");
        sessionKeys[keccak256(abi.encode(sk))] = true;
    }

    function executeWithSessionKey(
        Call[] calldata calls,
        SessionKey calldata sk,
        bytes calldata signature
    ) external {
        require(sessionKeys[keccak256(abi.encode(sk))], "Unknown key");
        require(block.timestamp >= sk.validAfter, "Too early");
        require(block.timestamp <= sk.validUntil, "Expired");

        bytes32 digest = keccak256(abi.encode(calls, sk));
        require(ECDSA.recover(digest, signature) == sk.key, "Bad sig");

        for (uint256 i = 0; i < calls.length; i++) {
            _validateTarget(calls[i].target, sk.allowedTargets);
            (bool ok,) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            require(ok, "Call failed");
        }
    }

    function _validateTarget(address target, address[] memory allowed) internal pure {
        for (uint256 i = 0; i < allowed.length; i++) {
            if (target == allowed[i]) return;
        }
        revert("Target not allowed");
    }
}
```

## EIP-7702 vs EIP-4337

| Feature | EIP-7702 | EIP-4337 |
|---------|----------|----------|
| Account type | EOA with delegation | Smart contract account |
| Infrastructure | Standard tx | Bundlers + EntryPoint |
| Gas overhead | Minimal | UserOp validation cost |
| Persistence | Per-tx or persistent | Permanent |
| Backwards compat | Full (same address) | New address |
| Batching | Yes | Yes |

## Key Considerations

- Authorization can set `chainId = 0` to be valid on all chains (useful but risky)
- Delegation is revocable: sign a new authorization pointing to `address(0)`
- The EOA's storage persists across delegations — clean up properly
- EOA nonce increments prevent replay of old authorizations
- `tx.origin == msg.sender` checks break for batched calls (avoid this pattern)
- Delegated code runs in the EOA's context (like delegatecall)

## Testing with Foundry

```solidity
function test_eip7702_batch() public {
    // Foundry supports EIP-7702 via vm.signAuthorization
    bytes memory auth = vm.signAuthorization(address(smartAccount), eoaPrivateKey);
    vm.attachAuthorization(auth);

    SmartAccount.Call[] memory calls = new SmartAccount.Call[](2);
    calls[0] = SmartAccount.Call(address(token), 0, abi.encodeCall(token.approve, (router, 1e18)));
    calls[1] = SmartAccount.Call(address(router), 0, abi.encodeCall(router.swap, (1e18)));

    vm.prank(eoa);
    SmartAccount(eoa).execute(calls);
}
```
