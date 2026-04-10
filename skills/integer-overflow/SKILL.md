---
name: integer-overflow
description: Integer safety patterns for Solidity 0.8+. Use when working with unchecked blocks, safe casting, or intermediate calculation overflow risks. Covers automatic checks, intentional overflow, phantom overflow, and safe math patterns.
---

# Integer Safety

## Solidity 0.8+ Automatic Checks

Since Solidity 0.8, arithmetic operations revert on overflow/underflow by default. This eliminates the need for SafeMath but introduces new considerations.

```solidity
// These all revert automatically on overflow (Solidity 0.8+)
uint256 a = type(uint256).max;
uint256 b = a + 1;  // reverts: arithmetic overflow

uint256 c = 0;
uint256 d = c - 1;  // reverts: arithmetic underflow

uint8 e = 255;
uint8 f = e + 1;    // reverts: arithmetic overflow
```

## Unchecked Blocks

Use `unchecked` when overflow is **mathematically impossible** and gas savings matter.

```solidity
// SAFE: loop counter cannot overflow (bounded by array length)
for (uint256 i; i < arr.length;) {
    processItem(arr[i]);
    unchecked { ++i; }
}

// SAFE: subtraction will not underflow (checked by prior condition)
function withdraw(uint256 amount) external {
    uint256 balance = balances[msg.sender];
    if (balance < amount) revert InsufficientBalance();

    unchecked {
        balances[msg.sender] = balance - amount; // balance >= amount guaranteed
    }
}

// SAFE: hash computation (intentional wrapping)
unchecked {
    uint256 hash = uint256(keccak256(abi.encodePacked(a))) + nonce;
}
```

### When Unchecked Is Dangerous

```solidity
// DANGEROUS: user-controlled values in unchecked
unchecked {
    uint256 result = userInput1 + userInput2; // could overflow silently
}

// DANGEROUS: complex arithmetic with multiple operations
unchecked {
    uint256 result = (a * b + c) / d; // any step could overflow
}
```

## Phantom Overflow

Intermediate calculations can overflow even when the final result fits.

```solidity
// VULNERABLE: a * b can overflow even if (a * b) / c fits in uint256
function mulDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
    return a * b / c; // reverts if a * b > type(uint256).max
}

// Example: mulDiv(2e18, 3e18, 1e18) should return 6e18
// But 2e18 * 3e18 = 6e36, which overflows uint256? No, 6e36 < 2^256
// But mulDiv(type(uint128).max, type(uint128).max, 1) WILL overflow

// FIXED: use Solmate's FixedPointMathLib which handles phantom overflow
import {FixedPointMathLib} from "solmate/utils/FixedPointMathLib.sol";

function mulDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
    return FixedPointMathLib.mulDiv(a, b, c); // assembly-based, no phantom overflow
}
```

### mulDiv Implementation Concept

```solidity
// FixedPointMathLib.mulDiv uses 512-bit intermediate math in assembly:
// 1. Compute full 512-bit product of a * b
// 2. Divide the 512-bit result by c
// 3. Return the 256-bit quotient (reverts if it doesn't fit)
```

## Safe Casting

Narrowing casts can silently truncate in Solidity. Always use explicit safe casting.

```solidity
// VULNERABLE: silent truncation
uint256 bigNumber = 300;
uint8 small = uint8(bigNumber); // small = 44 (300 % 256), NO revert!

// SAFE: explicit overflow check
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
using SafeCast for uint256;

uint256 bigNumber = 300;
uint8 small = bigNumber.toUint8(); // reverts: SafeCast: value doesn't fit in 8 bits
```

### Common Safe Cast Operations

```solidity
using SafeCast for uint256;
using SafeCast for int256;

uint256 value = 1000;

uint128 a = value.toUint128();  // reverts if > type(uint128).max
uint96 b = value.toUint96();    // reverts if > type(uint96).max
uint64 c = value.toUint64();    // reverts if > type(uint64).max
uint48 d = value.toUint48();    // reverts if > type(uint48).max
uint32 e = value.toUint32();    // reverts if > type(uint32).max

int256 signed = int256(value);  // reverts if > type(int256).max
```

## Type Boundaries

```solidity
// Know your type limits
type(uint8).max    == 255
type(uint16).max   == 65_535
type(uint32).max   == 4_294_967_295
type(uint48).max   == 281_474_976_710_655
type(uint64).max   == 18_446_744_073_709_551_615
type(uint96).max   == 79_228_162_514_264_337_593_543_950_335
type(uint128).max  == 340_282_366_920_938_463_463_374_607_431_768_211_455
type(uint256).max  == 2^256 - 1

type(int256).min   == -(2^255)
type(int256).max   == 2^255 - 1
```

## Signed Integer Gotchas

```solidity
// Negation overflow: -type(int256).min overflows
int256 minValue = type(int256).min;
int256 negated = -minValue; // REVERTS: overflow (no positive equivalent)

// Division edge case
int256 result = type(int256).min / (-1); // REVERTS: same as negation overflow

// Abs function must handle min value
function abs(int256 x) internal pure returns (uint256) {
    if (x == type(int256).min) revert AbsOverflow();
    return uint256(x >= 0 ? x : -x);
}
```

## Accumulator Overflow

For accounting that accumulates over time, consider if the accumulator can overflow.

```solidity
// Reward accumulator pattern
// rewardPerTokenStored grows continuously — can it overflow uint256?
// With 1e18 precision and 1e18 rewards/sec for 100 years:
// 1e18 * 1e18 * 100 * 365 * 86400 ≈ 3.15e33, well under 2^256 ≈ 1.15e77
// Safe for practical purposes, but document the assumption

uint256 public rewardPerTokenStored;

function rewardPerToken() public view returns (uint256) {
    if (totalSupply == 0) return rewardPerTokenStored;
    return rewardPerTokenStored + (
        (lastRewardTime() - lastUpdateTime) * rewardRate * PRECISION / totalSupply
    );
}
```

## Integer Safety Checklist

- [ ] `unchecked` only used where overflow is mathematically impossible
- [ ] Comment explaining why overflow is impossible for each `unchecked` block
- [ ] No silent narrowing casts — use SafeCast
- [ ] mulDiv from Solmate for multiplication followed by division
- [ ] Accumulator overflow analyzed for worst-case scenarios
- [ ] Signed integer edge cases handled (`type(int256).min`)
- [ ] Type boundaries documented for packed struct fields
