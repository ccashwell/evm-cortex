---
name: erc1155-patterns
description: Use when building multi-token contracts with ERC-1155. Covers batch operations, URI handling, supply tracking, hybrid fungible and non-fungible patterns, and game item architectures.
---

# ERC-1155 Multi-Token Patterns

## Standard Interface

```solidity
interface IERC1155 {
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external view returns (uint256[] memory);
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address account, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function safeBatchTransferFrom(
        address from, address to, uint256[] calldata ids,
        uint256[] calldata amounts, bytes calldata data
    ) external;
}
```

## Implementation Pattern

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC1155URIStorage} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GameItems is ERC1155, ERC1155Supply, ERC1155URIStorage, Ownable {
    // Token type constants
    uint256 public constant GOLD = 0;       // fungible
    uint256 public constant SILVER = 1;     // fungible
    uint256 public constant SWORD = 2;      // non-fungible (supply = 1 each)
    uint256 public constant SHIELD = 3;     // semi-fungible

    uint256 private _nextUniqueId = 1000;

    mapping(uint256 tokenId => uint256 maxSupply) public caps;

    constructor(string memory baseUri) ERC1155(baseUri) Ownable(msg.sender) {
        caps[GOLD] = type(uint256).max;
        caps[SILVER] = type(uint256).max;
        caps[SWORD] = 100;
        caps[SHIELD] = 500;
    }

    function mintFungible(address to, uint256 id, uint256 amount) external onlyOwner {
        require(totalSupply(id) + amount <= caps[id], "Cap exceeded");
        _mint(to, id, amount, "");
    }

    function mintBatch(address to, uint256[] calldata ids, uint256[] calldata amounts)
        external onlyOwner
    {
        for (uint256 i = 0; i < ids.length; i++) {
            require(totalSupply(ids[i]) + amounts[i] <= caps[ids[i]], "Cap exceeded");
        }
        _mintBatch(to, ids, amounts, "");
    }

    function mintUnique(address to, string calldata tokenUri) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextUniqueId++;
        caps[tokenId] = 1;
        _mint(to, tokenId, 1, "");
        _setURI(tokenId, tokenUri);
        return tokenId;
    }

    function uri(uint256 tokenId) public view override(ERC1155, ERC1155URIStorage) returns (string memory) {
        return super.uri(tokenId);
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }
}
```

## URI Handling

ERC-1155 uses a single URI template with `{id}` substitution:

```
https://api.example.com/tokens/{id}.json
```

The `{id}` is replaced with the lowercase hex token ID, zero-padded to 64 characters:
`https://api.example.com/tokens/0000000000000000000000000000000000000000000000000000000000000001.json`

For per-token URIs, use `ERC1155URIStorage`:

```solidity
_setURI(tokenId, "ipfs://QmUniqueHash");
// Emits URI(value, tokenId)
```

## Batch Operations

Batch transfers save significant gas compared to individual transfers:

```solidity
// Transfer multiple token types in one tx
uint256[] memory ids = new uint256[](3);
uint256[] memory amounts = new uint256[](3);
ids[0] = GOLD;     amounts[0] = 100;
ids[1] = SILVER;   amounts[1] = 50;
ids[2] = SWORD;    amounts[2] = 1;

gameItems.safeBatchTransferFrom(alice, bob, ids, amounts, "");
```

Gas savings: batch of 10 transfers costs ~60% of 10 individual transfers.

## Receiver Interface

Contracts receiving ERC-1155 tokens must implement:

```solidity
interface IERC1155Receiver {
    function onERC1155Received(
        address operator, address from,
        uint256 id, uint256 value, bytes calldata data
    ) external returns (bytes4);

    function onERC1155BatchReceived(
        address operator, address from,
        uint256[] calldata ids, uint256[] calldata values, bytes calldata data
    ) external returns (bytes4);
}
```

## Hybrid Fungible + Non-Fungible Pattern

Use ID ranges to distinguish token types:

```solidity
// IDs 0-999: fungible tokens (can have supply > 1)
// IDs 1000+: unique NFTs (supply == 1)

function isFungible(uint256 id) public pure returns (bool) {
    return id < 1000;
}

function isNonFungible(uint256 id) public view returns (bool) {
    return id >= 1000 && totalSupply(id) == 1;
}
```

## ERC-1155 vs ERC-721 Decision

| Factor | ERC-721 | ERC-1155 |
|--------|---------|----------|
| Token types | One per contract | Many per contract |
| Batch transfers | Not native | Built-in |
| Gas (deploy) | Lower | Higher |
| Gas (batch ops) | Higher | Much lower |
| Marketplace support | Universal | Growing |
| Fungible support | No | Yes |

Choose ERC-1155 when: multiple token types, game items, mixed fungible/non-fungible, batch operations needed.

## Security Checklist

- [ ] Implement both `onERC1155Received` and `onERC1155BatchReceived` in receiver contracts
- [ ] Validate array lengths match in batch operations
- [ ] Track supply with `ERC1155Supply` if caps are needed
- [ ] Use `_update` hook for custom transfer logic (not `_beforeTokenTransfer`)
- [ ] Test `supportsInterface` for ERC-1155 and ERC-165
- [ ] Guard against reentrancy (safe transfers call external code)
