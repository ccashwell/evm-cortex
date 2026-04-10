---
name: erc721-patterns
description: Use when building or integrating ERC-721 NFT contracts. Covers standard interface, metadata, enumerable extension, royalties (EIP-2981), lazy minting, soulbound tokens, and safe minting patterns.
---

# ERC-721 NFT Patterns

## Standard Interface

```solidity
interface IERC721 {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}
```

## Full NFT Contract Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Royalty} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract MyNFT is ERC721, ERC721Enumerable, ERC721URIStorage, ERC721Royalty, Ownable {
    uint256 private _nextTokenId;
    string private _baseTokenURI;
    uint256 public maxSupply;
    uint256 public mintPrice;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_,
        uint256 mintPrice_,
        uint96 royaltyBps // e.g. 500 = 5%
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        _baseTokenURI = baseURI_;
        maxSupply = maxSupply_;
        mintPrice = mintPrice_;
        _setDefaultRoyalty(msg.sender, royaltyBps);
    }

    function mint(address to) external payable {
        require(msg.value >= mintPrice, "Insufficient payment");
        require(_nextTokenId < maxSupply, "Max supply reached");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
    }

    function withdraw() external onlyOwner {
        (bool ok,) = msg.sender.call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }

    // Required overrides
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721Enumerable, ERC721URIStorage, ERC721Royalty) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Metadata Patterns

### Onchain Metadata (Base64-encoded JSON)

```solidity
function tokenURI(uint256 tokenId) public view override returns (string memory) {
    _requireOwned(tokenId);
    return string(abi.encodePacked(
        "data:application/json;base64,",
        Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"Token #', Strings.toString(tokenId),
            '","description":"Onchain NFT",',
            '"image":"data:image/svg+xml;base64,', _generateSVG(tokenId), '"}'
        ))))
    ));
}
```

### IPFS Metadata

Set `baseURI` to `ipfs://QmHash/` and each token resolves to `ipfs://QmHash/0`, `ipfs://QmHash/1`, etc. Store metadata JSON files in IPFS with matching filenames.

## EIP-2981 Royalties

```solidity
// Set default royalty for all tokens (5%)
_setDefaultRoyalty(royaltyReceiver, 500);

// Override per token
_setTokenRoyalty(tokenId, receiver, 1000); // 10%

// Marketplaces call:
(address receiver, uint256 amount) = nft.royaltyInfo(tokenId, salePrice);
```

## Soulbound Tokens (Non-Transferable)

```solidity
function _update(address to, uint256 tokenId, address auth)
    internal
    override
    returns (address)
{
    address from = _ownerOf(tokenId);
    if (from != address(0) && to != address(0)) {
        revert("Soulbound: transfer disabled");
    }
    return super._update(to, tokenId, auth);
}
```

## Lazy Minting with Signatures

```solidity
struct MintVoucher {
    uint256 tokenId;
    uint256 price;
    string uri;
    bytes signature;
}

function redeemVoucher(MintVoucher calldata voucher) external payable {
    require(msg.value >= voucher.price, "Insufficient payment");
    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
        keccak256("MintVoucher(uint256 tokenId,uint256 price,string uri)"),
        voucher.tokenId, voucher.price, keccak256(bytes(voucher.uri))
    )));
    address signer = ECDSA.recover(digest, voucher.signature);
    require(signer == owner(), "Invalid signature");
    _safeMint(msg.sender, voucher.tokenId);
    _setTokenURI(voucher.tokenId, voucher.uri);
}
```

## Safe Minting Callback

`_safeMint` calls `onERC721Received` on the recipient if it is a contract. This prevents tokens from being locked in contracts that cannot handle them. Always use `_safeMint` over `_mint` unless you have a specific reason (e.g. reentrancy concerns).

```solidity
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
    // Must return IERC721Receiver.onERC721Received.selector
}
```

## NFT Security Checklist

- [ ] Use `_safeMint` to prevent tokens locked in non-receiver contracts
- [ ] Guard against reentrancy in mint functions (safeMint calls external code)
- [ ] Validate `tokenId` exists before queries (`_requireOwned`)
- [ ] Limit mints per transaction / per wallet to prevent gas griefing
- [ ] Use commit-reveal for fair distribution (prevent MEV sniping)
- [ ] Validate royalty basis points (max 10000 = 100%)
- [ ] Test `supportsInterface` returns true for ERC-721, ERC-165, ERC-2981
