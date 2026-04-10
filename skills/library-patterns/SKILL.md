---
name: library-patterns
description: Library design patterns for reusable Solidity code. Use when creating shared utilities, math libraries, or type-safe operations. Covers internal vs external libraries, using-for, deployment patterns, and common math libraries.
---

# Library Patterns

## Internal vs External Libraries

| Feature | Internal (embedded) | External (deployed) |
|---------|-------------------|-------------------|
| Deployment | Inlined into calling contract | Deployed separately, linked |
| Call type | JUMP (cheap) | DELEGATECALL (expensive) |
| State access | Reads caller's storage | Reads caller's storage via delegatecall |
| Gas cost | Lower per call | Higher per call, lower deploy if shared |
| Use case | Small utilities, math | Large shared code across many contracts |

```solidity
// Internal library — inlined at compile time
library SafeCast {
    error SafeCast_Overflow();

    function toUint128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) revert SafeCast_Overflow();
        return uint128(value);
    }

    function toUint96(uint256 value) internal pure returns (uint96) {
        if (value > type(uint96).max) revert SafeCast_Overflow();
        return uint96(value);
    }

    function toInt256(uint256 value) internal pure returns (int256) {
        if (value > uint256(type(int256).max)) revert SafeCast_Overflow();
        return int256(value);
    }
}
```

## Using-For Directives

Attach library functions to types for cleaner syntax.

```solidity
using SafeCast for uint256;
using FixedPointMathLib for uint256;

function calculateShares(uint256 assets, uint256 totalAssets, uint256 totalShares)
    internal
    pure
    returns (uint256)
{
    return assets.mulDivDown(totalShares, totalAssets);
}

function packTimestamp(uint256 timestamp) internal pure returns (uint48) {
    return timestamp.toUint48();
}
```

### Global Using-For (Solidity 0.8.13+)

```solidity
// In a shared file, apply globally to all files that import it
using SafeCast for uint256 global;
using FixedPointMathLib for uint256 global;
```

## Math Libraries

### Solmate FixedPointMathLib

The gold standard for fixed-point math. Gas-optimized with assembly.

```solidity
import {FixedPointMathLib} from "solmate/utils/FixedPointMathLib.sol";

using FixedPointMathLib for uint256;

// Multiply then divide, rounding down — prevents phantom overflow
uint256 shares = assets.mulDivDown(totalShares, totalAssets);

// Multiply then divide, rounding up — useful for debt calculations
uint256 debt = borrowed.mulDivUp(interestRate, PRECISION);

// WAD math (18 decimal fixed point)
uint256 result = a.mulWadDown(b);  // (a * b) / 1e18, round down
uint256 result = a.divWadUp(b);    // (a * 1e18) / b, round up

// Square root
uint256 sqrtPrice = FixedPointMathLib.sqrt(price);
```

### When to Round Up vs Down

| Context | Direction | Reason |
|---------|-----------|--------|
| Minting shares from assets | Round down | Fewer shares protects vault |
| Burning shares for assets | Round down | Fewer assets protects vault |
| Calculating debt owed | Round up | More debt protects lender |
| Calculating collateral required | Round up | More collateral protects protocol |
| Fee calculation | Round up | Ensures protocol collects at least the fee |

## Struct Libraries

Encapsulate operations on custom types in libraries.

```solidity
struct Position {
    uint128 collateral;
    uint128 debt;
    uint48 lastUpdate;
    uint16 healthFactor;
}

library PositionLib {
    using SafeCast for uint256;
    using FixedPointMathLib for uint256;

    error Position_Undercollateralized();

    function addCollateral(Position storage self, uint256 amount) internal {
        self.collateral += amount.toUint128();
        self.lastUpdate = uint48(block.timestamp);
    }

    function addDebt(Position storage self, uint256 amount) internal {
        self.debt += amount.toUint128();
        self.lastUpdate = uint48(block.timestamp);
    }

    function healthFactor(Position storage self, uint256 price)
        internal
        view
        returns (uint256)
    {
        if (self.debt == 0) return type(uint256).max;
        return uint256(self.collateral).mulDivDown(price, uint256(self.debt));
    }

    function isHealthy(Position storage self, uint256 price, uint256 minHealth)
        internal
        view
        returns (bool)
    {
        return healthFactor(self, price) >= minHealth;
    }
}
```

Usage:

```solidity
using PositionLib for Position;

mapping(address => Position) public positions;

function addCollateral(uint256 amount) external {
    positions[msg.sender].addCollateral(amount);
    // ...
}
```

## Enumerable Set / Map Libraries

For onchain iteration requirements, use OpenZeppelin's EnumerableSet.

```solidity
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

using EnumerableSet for EnumerableSet.AddressSet;

EnumerableSet.AddressSet private _whitelistedTokens;

function addToken(address token) external onlyOwner {
    if (!_whitelistedTokens.add(token)) revert AlreadyWhitelisted();
}

function isWhitelisted(address token) external view returns (bool) {
    return _whitelistedTokens.contains(token);
}

function getWhitelistedTokens() external view returns (address[] memory) {
    return _whitelistedTokens.values();
}
```

## Library Design Guidelines

1. **Pure/view functions only** — libraries should not have side effects beyond the storage pointer passed to them
2. **Single responsibility** — one library per type or domain
3. **Internal functions preferred** — avoids DELEGATECALL overhead
4. **Revert on invalid input** — don't return sentinel values
5. **Custom errors over require strings** — consistent with protocol patterns
6. **Gas-test critical paths** — math libraries are hot paths, benchmark them

## Library Design Checklist

- [ ] Library has a single, focused responsibility
- [ ] All functions are `internal` unless deployment sharing is needed
- [ ] `using-for` applied to relevant types
- [ ] Math operations use audited libraries (Solmate, OpenZeppelin)
- [ ] Rounding direction explicitly chosen and documented
- [ ] Safe casting used for all type narrowing
- [ ] Custom errors defined within the library
- [ ] NatSpec on all public-facing functions
