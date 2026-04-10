---
name: signature-vulnerabilities
description: Signature attack vectors and safe verification patterns for Solidity. Use when implementing permit, meta-transactions, gasless approvals, or any signature-based authentication. Covers replay attacks, EIP-712, nonce management, malleability, and permit front-running.
---

# Signature Vulnerabilities

## Replay Attacks

A valid signature can be reused unless explicitly prevented.

### Cross-Chain Replay

A signature valid on Ethereum mainnet can be replayed on Arbitrum, Optimism, etc.

```solidity
// VULNERABLE: no chain ID in signed data
bytes32 hash = keccak256(abi.encodePacked(user, amount, nonce));

// FIXED: include chain ID via EIP-712 domain separator
bytes32 public immutable DOMAIN_SEPARATOR;

constructor() {
    DOMAIN_SEPARATOR = keccak256(abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256(bytes("MyProtocol")),
        keccak256(bytes("1")),
        block.chainid,
        address(this)
    ));
}
```

### Cross-Contract Replay

A signature for contract A can be replayed on contract B if the verifying contract address isn't included.

**Defense**: Always include `address(this)` in the domain separator (EIP-712 handles this).

### Same-Contract Replay

Reusing a signature multiple times on the same contract.

**Defense**: Nonce tracking.

```solidity
mapping(address => uint256) public nonces;

function executeWithSignature(
    address user,
    uint256 amount,
    uint256 deadline,
    uint8 v, bytes32 r, bytes32 s
) external {
    if (block.timestamp > deadline) revert Expired();

    bytes32 structHash = keccak256(abi.encode(
        EXECUTE_TYPEHASH,
        user,
        amount,
        nonces[user]++,
        deadline
    ));

    bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

    address recovered = ecrecover(digest, v, r, s);
    if (recovered == address(0) || recovered != user) revert InvalidSignature();

    _execute(user, amount);
}
```

## EIP-712 Typed Data Signing

The standard for structured data signing. Provides human-readable signing prompts in wallets.

```solidity
bytes32 public constant EXECUTE_TYPEHASH = keccak256(
    "Execute(address user,uint256 amount,uint256 nonce,uint256 deadline)"
);

function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
    return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
}
```

### Nested Struct Hashing

```solidity
// For complex types, hash inner structs first
bytes32 constant ORDER_TYPEHASH = keccak256(
    "Order(address maker,Asset makerAsset,Asset takerAsset,uint256 nonce,uint256 deadline)"
    "Asset(address token,uint256 amount)"
);

bytes32 constant ASSET_TYPEHASH = keccak256(
    "Asset(address token,uint256 amount)"
);

function hashOrder(Order memory order) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        ORDER_TYPEHASH,
        order.maker,
        hashAsset(order.makerAsset),
        hashAsset(order.takerAsset),
        order.nonce,
        order.deadline
    ));
}

function hashAsset(Asset memory asset) internal pure returns (bytes32) {
    return keccak256(abi.encode(ASSET_TYPEHASH, asset.token, asset.amount));
}
```

## Signature Malleability

ECDSA signatures have two valid forms for the same message (s and n-s). If both are accepted, a signature can be "replayed" with the alternate form.

```solidity
// VULNERABLE: accepts both s values
address recovered = ecrecover(hash, v, r, s);

// FIXED: enforce low-s value (EIP-2 canonical form)
function _verifySignature(bytes32 hash, uint8 v, bytes32 r, bytes32 s)
    internal
    pure
    returns (address)
{
    // s must be in the lower half of the curve order
    if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
        revert MalleableSignature();
    }

    address recovered = ecrecover(hash, v, r, s);
    if (recovered == address(0)) revert InvalidSignature();

    return recovered;
}
```

**Best practice**: Use OpenZeppelin's ECDSA library which handles malleability checks.

```solidity
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

function verify(bytes32 hash, bytes memory signature) internal pure returns (address) {
    return ECDSA.recover(hash, signature); // handles malleability check
}
```

## ecrecover Returns address(0)

`ecrecover` returns `address(0)` for invalid signatures instead of reverting. Always check.

```solidity
// VULNERABLE: doesn't check for address(0)
address signer = ecrecover(hash, v, r, s);
require(signer == expectedSigner); // passes if expectedSigner is address(0)

// FIXED: explicit zero check
address signer = ecrecover(hash, v, r, s);
if (signer == address(0)) revert InvalidSignature();
if (signer != expectedSigner) revert Unauthorized();
```

## EIP-2612 Permit Front-Running

An attacker can front-run a `permit` + action transaction by extracting the permit signature and calling `permit` first. The user's transaction reverts because the nonce is consumed.

```solidity
// VULNERABLE: permit reverts if already used
function depositWithPermit(
    uint256 amount, uint256 deadline,
    uint8 v, bytes32 r, bytes32 s
) external {
    token.permit(msg.sender, address(this), amount, deadline, v, r, s); // ← reverts if front-run
    token.safeTransferFrom(msg.sender, address(this), amount);
}

// FIXED: try/catch on permit, proceed if allowance already set
function depositWithPermit(
    uint256 amount, uint256 deadline,
    uint8 v, bytes32 r, bytes32 s
) external {
    try token.permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
    token.safeTransferFrom(msg.sender, address(this), amount);
}
```

## Nonce Management Patterns

### Sequential Nonces

Simple, prevents replay, but requires sequential use.

```solidity
mapping(address => uint256) public nonces;

// User must use nonce 0, then 1, then 2, etc.
// Cancel a nonce by calling with a no-op payload
```

### Bitmap Nonces (Permit2 style)

Allows out-of-order nonce consumption.

```solidity
// Nonces stored as bitmaps: nonce 256*wordPos + bitPos
mapping(address => mapping(uint256 => uint256)) public nonceBitmap;

function _useNonce(address owner, uint256 nonce) internal {
    uint256 wordPos = nonce >> 8;
    uint256 bitPos = nonce & 0xff;
    uint256 bit = 1 << bitPos;

    uint256 word = nonceBitmap[owner][wordPos];
    if (word & bit != 0) revert NonceAlreadyUsed();
    nonceBitmap[owner][wordPos] = word | bit;
}
```

## Signature Verification Checklist

- [ ] EIP-712 domain separator includes chainId and verifyingContract
- [ ] Domain separator recomputed if chainId can change (forking)
- [ ] Nonce included and incremented to prevent replay
- [ ] Deadline/expiry included for time-bound signatures
- [ ] ecrecover result checked against address(0)
- [ ] Signature malleability mitigated (low-s check or OZ ECDSA)
- [ ] Permit calls wrapped in try/catch to prevent front-running griefing
- [ ] Typed data hashing follows EIP-712 spec exactly
- [ ] Offchain signing tested against onchain verification
