---
name: eip712-signing
description: Use when implementing EIP-712 typed structured data signing. Covers domain separator, type hashing, encoding rules, DOMAIN_SEPARATOR caching, chain ID fork handling, permit (EIP-2612), and gasless transaction patterns.
---

# EIP-712 Typed Structured Data Signing

## Overview

EIP-712 provides human-readable signing for structured data. Users see what they're signing in their wallet instead of opaque hex. Used by EIP-2612 (Permit), governance voting, meta-transactions, and order books.

## Domain Separator

```solidity
bytes32 constant DOMAIN_TYPEHASH = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);

function _buildDomainSeparator() internal view returns (bytes32) {
    return keccak256(abi.encode(
        DOMAIN_TYPEHASH,
        keccak256(bytes("MyProtocol")),
        keccak256(bytes("1")),
        block.chainid,
        address(this)
    ));
}
```

## Chain ID Handling for Forks

Cache the domain separator at construction but recompute if chain ID changes (fork protection):

```solidity
bytes32 private immutable _cachedDomainSeparator;
uint256 private immutable _cachedChainId;
address private immutable _cachedThis;

bytes32 private immutable _hashedName;
bytes32 private immutable _hashedVersion;

constructor(string memory name, string memory version) {
    _hashedName = keccak256(bytes(name));
    _hashedVersion = keccak256(bytes(version));
    _cachedChainId = block.chainid;
    _cachedThis = address(this);
    _cachedDomainSeparator = _buildDomainSeparator();
}

function DOMAIN_SEPARATOR() public view returns (bytes32) {
    if (block.chainid == _cachedChainId && address(this) == _cachedThis) {
        return _cachedDomainSeparator;
    }
    return _buildDomainSeparator();
}
```

OpenZeppelin's `EIP712` base contract handles all of this automatically.

## Type Hash and Encoding

```solidity
bytes32 constant PERMIT_TYPEHASH = keccak256(
    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
);

function _hashPermit(
    address owner, address spender, uint256 value, uint256 nonce, uint256 deadline
) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        PERMIT_TYPEHASH, owner, spender, value, nonce, deadline
    ));
}
```

## Full Signing Flow

```solidity
function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
    return keccak256(abi.encodePacked(
        "\x19\x01",
        DOMAIN_SEPARATOR(),
        structHash
    ));
}
```

## Complete EIP-2612 Permit Implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

contract PermitToken is ERC20, EIP712, Nonces {
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    constructor() ERC20("Permit Token", "PMT") EIP712("Permit Token", "1") {
        _mint(msg.sender, 1_000_000e18);
    }

    function permit(
        address owner, address spender, uint256 value,
        uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) external {
        require(block.timestamp <= deadline, "Permit expired");

        bytes32 structHash = keccak256(abi.encode(
            PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == owner, "Invalid signature");

        _approve(owner, spender, value);
    }
}
```

## Offchain Signing (ethers.js / viem)

```typescript
import { createWalletClient, custom } from 'viem';

const domain = {
  name: 'MyProtocol',
  version: '1',
  chainId: 1,
  verifyingContract: '0xContractAddress...' as const,
};

const types = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const message = {
  maker: '0xAlice...',
  token: '0xToken...',
  amount: 1000000000000000000n,
  nonce: 0n,
  deadline: 1700000000n,
};

const signature = await walletClient.signTypedData({ domain, types, primaryType: 'Order', message });
```

## Nested Structs

For structs containing other structs, the type string includes all referenced types in alphabetical order:

```solidity
bytes32 constant ORDER_TYPEHASH = keccak256(
    "Order(address maker,Asset asset,uint256 deadline)"
    "Asset(address token,uint256 amount)"
);

bytes32 constant ASSET_TYPEHASH = keccak256(
    "Asset(address token,uint256 amount)"
);

function _hashOrder(Order memory order) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        ORDER_TYPEHASH,
        order.maker,
        _hashAsset(order.asset),
        order.deadline
    ));
}

function _hashAsset(Asset memory asset) internal pure returns (bytes32) {
    return keccak256(abi.encode(ASSET_TYPEHASH, asset.token, asset.amount));
}
```

## Foundry Testing

```solidity
function test_permit() public {
    uint256 ownerKey = 0xA11CE;
    address owner = vm.addr(ownerKey);
    _mint(owner, 1e18);

    bytes32 digest = token.DOMAIN_SEPARATOR();
    bytes32 structHash = keccak256(abi.encode(
        PERMIT_TYPEHASH, owner, spender, 1e18, 0, block.timestamp + 1 hours
    ));
    bytes32 hash = keccak256(abi.encodePacked("\x19\x01", digest, structHash));

    (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
    token.permit(owner, spender, 1e18, block.timestamp + 1 hours, v, r, s);

    assertEq(token.allowance(owner, spender), 1e18);
}
```

## Security Checklist

- [ ] Always check `deadline >= block.timestamp`
- [ ] Use auto-incrementing nonces to prevent replay attacks
- [ ] Cache `DOMAIN_SEPARATOR` but recompute on chain ID change
- [ ] Include `verifyingContract` in domain to prevent cross-contract replay
- [ ] Validate recovered signer is not `address(0)` (invalid signature)
- [ ] Use OpenZeppelin's `EIP712` base for correct implementation
- [ ] Hash dynamic types (bytes, string) with `keccak256` before encoding
- [ ] Arrays are encoded as `keccak256(abi.encodePacked(element1, element2, ...))`
