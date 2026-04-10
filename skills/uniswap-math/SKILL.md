---
name: uniswap-math
description: Use when working with Uniswap pricing math, tick calculations, liquidity formulas, or Q64.96 fixed-point arithmetic. Covers TickMath, SqrtPriceMath, SwapMath, FullMath, TickBitmap, LiquidityAmounts, Position library, and all key formulas for concentrated liquidity AMMs.
---

# Uniswap Concentrated Liquidity Math

## Q64.96 Fixed-Point Arithmetic

Uniswap V3/V4 stores prices as Q64.96 fixed-point numbers representing the **square root** of the price ratio. This encoding fits in `uint160` and enables efficient swap math without division.

```
sqrtPriceX96 = √(price) × 2⁹⁶
```

- 64 bits for the integer part, 96 bits for the fractional part
- Stored as `uint160` — fits alongside `int24 tick` and `uint128 liquidity` in the pool's `Slot0`
- Price of token1 in terms of token0: `price = (sqrtPriceX96 / 2⁹⁶)²`
- Inverse conversion: `sqrtPriceX96 = √(price) × 2⁹⁶`

### Why Store √P Instead of P

1. The core swap formulas only need `√P`, never `P` directly
2. `amount1 = L × Δ√P` is a simple multiplication — no square root at runtime
3. `amount0 = L × Δ(1/√P)` avoids computing reciprocals of prices
4. Avoids the precision loss of squaring and rooting during swaps

### Decimal Normalization

Prices are always in **raw token units** — you must account for decimals manually.

```
token0 = WETH (18 decimals)
token1 = USDC (6 decimals)

Human-readable price: 1 ETH = 3000 USDC
Raw price (token1/token0) = 3000 × 10⁶ / 10¹⁸ = 3000 × 10⁻¹²

sqrtPrice = √(3000 × 10⁻¹²) = √(3 × 10⁻⁹) ≈ 5.47722558 × 10⁻⁵
sqrtPriceX96 = 5.47722558 × 10⁻⁵ × 2⁹⁶ ≈ 4_339_505_179_874_779_489_878_115
```

For a pair where both tokens have 18 decimals (e.g., WETH/DAI at price 3000):

```
Raw price = 3000 (decimals cancel)
sqrtPrice = √3000 ≈ 54.7722558
sqrtPriceX96 = 54.7722558 × 2⁹⁶ ≈ 4_339_505_179_874_779_163_484_739_850_572_800
```

### Converting sqrtPriceX96 to Human Price

```solidity
// In Solidity — use FullMath to avoid overflow
uint256 priceX192 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1);
// priceX192 is price * 2^192, divide by 2^192 to get raw price
// For display: rawPrice * 10^(decimals0 - decimals1) = human price
```

```python
# In Python (offchain)
def sqrtPriceX96_to_price(sqrtPriceX96, decimals0, decimals1):
    price = (sqrtPriceX96 / 2**96) ** 2
    adjusted = price * 10 ** (decimals0 - decimals1)
    return adjusted

# ETH/USDC: sqrtPriceX96 = 4_339_505_179_874_779_489_878_115
sqrtPriceX96_to_price(4_339_505_179_874_779_489_878_115, 18, 6)
# ≈ 3000.0
```

## TickMath Library

**Import:** `import {TickMath} from "v4-core/src/libraries/TickMath.sol";`

### Constants

```solidity
int24 internal constant MIN_TICK = -887272;
int24 internal constant MAX_TICK = 887272;
int24 internal constant MIN_TICK_SPACING = 1;
int24 internal constant MAX_TICK_SPACING = type(int16).max; // 32767

uint160 internal constant MIN_SQRT_PRICE = 4295128739;
uint160 internal constant MAX_SQRT_PRICE =
    1461446703485210103287273052203988822378723970342;
```

`MIN_SQRT_PRICE` and `MAX_SQRT_PRICE` correspond to the prices at `MIN_TICK` and `MAX_TICK`. The pool's `sqrtPriceX96` is always in `(MIN_SQRT_PRICE, MAX_SQRT_PRICE)` — strictly exclusive.

### Core Functions

```solidity
/// @notice Returns the sqrt price at the given tick as a Q64.96
/// @dev Reverts if |tick| > MAX_TICK
function getSqrtPriceAtTick(int24 tick)
    internal pure returns (uint160 sqrtPriceX96);

/// @notice Returns the tick at the given sqrt price
/// @dev Returns the largest tick whose price ≤ sqrtPriceX96
/// @dev sqrtPriceX96 must be in (MIN_SQRT_PRICE, MAX_SQRT_PRICE)
function getTickAtSqrtPrice(uint160 sqrtPriceX96)
    internal pure returns (int24 tick);

/// @notice Returns the maximum usable tick for a given tick spacing
function maxUsableTick(int24 tickSpacing)
    internal pure returns (int24);

/// @notice Returns the minimum usable tick for a given tick spacing
function minUsableTick(int24 tickSpacing)
    internal pure returns (int24);
```

### Tick-Price Relationship

Each tick `i` maps to a price: **P(i) = 1.0001ⁱ**

Every tick is exactly 1 basis point (0.01%) away from its neighbors. This is the key invariant of concentrated liquidity — prices are spaced geometrically, not linearly.

```
tick = 0      → price = 1.0
tick = 1      → price = 1.0001
tick = -1     → price = 0.99990001...
tick = 100    → price ≈ 1.01005
tick = 10000  → price ≈ 2.71828  (≈ e)
tick = 23028  → price ≈ 10.0
tick = 46054  → price ≈ 100.0
tick = 69082  → price ≈ 1000.0
tick = -69082 → price ≈ 0.001
tick = 887272 → price ≈ 3.40 × 10³⁸  (near uint128 max)
```

Useful relationship: `tick ≈ ln(price) / ln(1.0001) ≈ ln(price) × 10000`

### Tick Spacing

Only ticks divisible by `tickSpacing` can be initialized with liquidity positions. Common tick spacings:

| Fee Tier | Tick Spacing | Price Granularity |
|----------|-------------|-------------------|
| 1 bps (0.01%) | 1 | Every tick — stablecoin pairs |
| 5 bps (0.05%) | 10 | 0.10% between usable ticks |
| 30 bps (0.30%) | 60 | 0.60% between usable ticks |
| 100 bps (1.00%) | 200 | 2.00% between usable ticks |

```solidity
// Usable ticks for tickSpacing = 60:
// ..., -120, -60, 0, 60, 120, 180, ...
int24 maxUsable = TickMath.maxUsableTick(60);  // 887220
int24 minUsable = TickMath.minUsableTick(60);  // -887220
```

### getTickAtSqrtPrice Floor Behavior

`getTickAtSqrtPrice` returns the **largest tick** where `getSqrtPriceAtTick(tick) <= sqrtPriceX96`. This is a floor operation. The current tick always satisfies:

```
getSqrtPriceAtTick(tick) <= currentSqrtPrice < getSqrtPriceAtTick(tick + 1)
```

## SqrtPriceMath Library

**Import:** `import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";`

This library computes token amounts from liquidity and price changes, and computes new prices from token amounts. Every function is aware of rounding direction.

### Amount Delta Functions

```solidity
/// @notice Gets the token0 delta for a liquidity and price range
function getAmount0Delta(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    uint128 liquidity,
    bool roundUp
) internal pure returns (uint256 amount0);

/// @notice Gets the token1 delta for a liquidity and price range
function getAmount1Delta(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    uint128 liquidity,
    bool roundUp
) internal pure returns (uint256 amount1);
```

**Signed overloads** exist that accept `int128 liquidity` — positive for adding liquidity (user pays, round up), negative for removing (user receives, round down):

```solidity
function getAmount0Delta(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    int128 liquidity
) internal pure returns (int256 amount0);

function getAmount1Delta(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    int128 liquidity
) internal pure returns (int256 amount1);
```

### Core Formulas

For a position spanning `[√P_a, √P_b]` where `√P_a < √P_b`:

```
                 √P_b - √P_a
amount0 = L × ─────────────────
               √P_a × √P_b

amount1 = L × (√P_b - √P_a)
```

Equivalently:

```
amount0 = L × (1/√P_a - 1/√P_b)
amount1 = L × (√P_b - √P_a)
```

**Intuition:** token0 is the "x" asset in xy=k. As price rises (more token1 per token0), the position holds less token0 and more token1. At `√P >= √P_b`, the position is entirely token1. At `√P <= √P_a`, entirely token0.

### Next Price Functions

```solidity
/// @notice Gets next sqrt price given token0 input/output
function getNextSqrtPriceFromAmount0RoundingUp(
    uint160 sqrtPX96,
    uint128 liquidity,
    uint256 amount,
    bool add
) internal pure returns (uint160);

/// @notice Gets next sqrt price given token1 input/output
function getNextSqrtPriceFromAmount1RoundingDown(
    uint160 sqrtPX96,
    uint128 liquidity,
    uint256 amount,
    bool add
) internal pure returns (uint160);

/// @notice Gets next sqrt price from an exact input amount
function getNextSqrtPriceFromInput(
    uint160 sqrtPX96,
    uint128 liquidity,
    uint256 amountIn,
    bool zeroForOne
) internal pure returns (uint160);

/// @notice Gets next sqrt price from an exact output amount
function getNextSqrtPriceFromOutput(
    uint160 sqrtPX96,
    uint128 liquidity,
    uint256 amountOut,
    bool zeroForOne
) internal pure returns (uint160);
```

**Next price from token0 amount:**

```
When adding token0 (buying token1): price decreases
√P_next = L × √P / (L + amount0 × √P)

When removing token0 (selling token1): price increases
√P_next = L × √P / (L - amount0 × √P)
```

**Next price from token1 amount:**

```
When adding token1 (buying token0): price increases
√P_next = √P + amount1 / L

When removing token1 (selling token0): price decreases
√P_next = √P - amount1 / L
```

### Rounding Convention

| Scenario | Amount0 | Amount1 | Price |
|----------|---------|---------|-------|
| User pays (add liquidity, swap input) | Round UP | Round UP | Round towards protocol benefit |
| User receives (remove liquidity, swap output) | Round DOWN | Round DOWN | Round towards protocol benefit |

The protocol must never undercharge or overpay. Every rounding decision favors the pool.

## SwapMath Library

**Import:** `import {SwapMath} from "v4-core/src/libraries/SwapMath.sol";`

### Constants

```solidity
uint24 internal constant MAX_SWAP_FEE = 1e6; // 100% — denominated in hundredths of a bip
```

Fee is in units of hundredths of a basis point (1/100 of 0.01% = 0.0001%). So `3000` = 0.30%, `500` = 0.05%, `10000` = 1.00%.

### Core Functions

```solidity
/// @notice Returns the target sqrt price, clamped to the price limit
function getSqrtPriceTarget(
    bool zeroForOne,
    uint160 sqrtPriceNextX96,
    uint160 sqrtPriceLimitX96
) internal pure returns (uint160 sqrtPriceTargetX96);

/// @notice Computes a single step within a swap
function computeSwapStep(
    uint160 sqrtPriceCurrentX96,
    uint160 sqrtPriceTargetX96,
    uint128 liquidity,
    int256 amountRemaining,
    uint24 feePips
) internal pure returns (
    uint160 sqrtPriceNextX96,
    uint256 amountIn,
    uint256 amountOut,
    uint256 feeAmount
);
```

### The Swap Loop

Every swap in Uniswap V3/V4 executes as a loop of steps across tick boundaries:

```
1. Start at current sqrtPrice and tick
2. LOOP:
   a. Find the next initialized tick in the swap direction (via TickBitmap)
   b. Clamp the target price to the user's price limit
   c. Call computeSwapStep(current, target, liquidity, remaining, fee)
   d. Update amountRemaining by subtracting amountIn + feeAmount (exact input)
      or amountOut (exact output)
   e. Accumulate fee growth: feeGrowthGlobal += feeAmount / liquidity
   f. If sqrtPriceNext reached the tick boundary:
      - Cross the tick: add/subtract the tick's liquidityNet from active liquidity
      - Update current tick
   g. If amountRemaining == 0 or sqrtPrice hits limit → exit loop
3. Update pool state: sqrtPrice, tick, liquidity, feeGrowthGlobal
```

### computeSwapStep Internals

For **exact input** (`amountRemaining > 0`):

```
1. Calculate amountIn to move price from current to target
2. If amountIn + fee <= remaining:
   - Price reaches target: sqrtPriceNext = target
   - Fee = remaining - amountIn (entire remainder is fee, capped)
3. Else:
   - Only partial move: compute sqrtPriceNext from input (after fee deduction)
   - amountRemainingLessFee = amountRemaining * (1e6 - feePips) / 1e6
   - sqrtPriceNext = getNextSqrtPriceFromInput(current, liquidity, amountRemainingLessFee)
4. Compute amountOut from the actual price movement
5. Fee = amountIn calculated from movement, then:
   feeAmount = amountRemaining - amountIn (for exact input, fee is the delta)
```

For **exact output** (`amountRemaining < 0`):

```
1. Calculate amountOut to move price from current to target
2. If amountOut <= |remaining|:
   - Price reaches target
3. Else:
   - Partial move: compute sqrtPriceNext from output
4. Compute amountIn from the actual price movement
5. feeAmount = mulDivRoundingUp(amountIn, feePips, 1e6 - feePips)
```

### zeroForOne Direction

| `zeroForOne` | Direction | Price Movement | token0 | token1 |
|---|---|---|---|---|
| `true` | Sell token0, buy token1 | Price decreases (√P goes down) | Input | Output |
| `false` | Sell token1, buy token0 | Price increases (√P goes up) | Output | Input |

## FullMath Library

**Import:** `import {FullMath} from "v4-core/src/libraries/FullMath.sol";`

```solidity
/// @notice 512-bit multiply then divide: (a × b) / denominator
/// @dev Will not overflow for any inputs where the result fits in uint256
function mulDiv(
    uint256 a,
    uint256 b,
    uint256 denominator
) internal pure returns (uint256 result);

/// @notice Same as mulDiv but rounds up
function mulDivRoundingUp(
    uint256 a,
    uint256 b,
    uint256 denominator
) internal pure returns (uint256 result);
```

`FullMath.mulDiv` computes `(a * b) / d` with a 512-bit intermediate product, preventing overflow when `a * b > type(uint256).max`. This is essential for Q64.96 math where multiplying two `uint160` values can produce up to 320 bits.

**Usage pattern in amount calculations:**

```solidity
// amount0 = liquidity * (sqrtPriceB - sqrtPriceA) / (sqrtPriceA * sqrtPriceB)
amount0 = FullMath.mulDiv(
    uint256(liquidity) << FixedPoint96.RESOLUTION,  // L * 2^96
    sqrtPriceBX96 - sqrtPriceAX96,
    sqrtPriceBX96
) / sqrtPriceAX96;
```

### UnsafeMath

**Import:** `import {UnsafeMath} from "v4-core/src/libraries/UnsafeMath.sol";`

```solidity
function divRoundingUp(uint256 x, uint256 d) internal pure returns (uint256);
```

Used internally where the caller has already validated inputs. Saves gas by skipping overflow checks.

## TickBitmap Library

**Import:** `import {TickBitmap} from "v4-core/src/libraries/TickBitmap.sol";`

Ticks that have liquidity positions starting or ending at them are "initialized." The bitmap provides efficient lookup of the next initialized tick during swaps.

### Storage Layout

```
The bitmap is a mapping(int16 => uint256):
  - The key (wordPos) is the tick index divided by 256
  - Each bit in the uint256 represents one compressed tick
  - Compressed tick = actual tick / tickSpacing

tick → compressed = tick / tickSpacing
compressed → wordPos = compressed >> 8   (arithmetic shift, so int16)
compressed → bitPos  = compressed % 256  (uint8, always positive modulo)
```

### Functions

```solidity
/// @notice Compresses a tick by the tick spacing
function compress(int24 tick, int24 tickSpacing)
    internal pure returns (int24 compressed);

/// @notice Returns word position and bit position within the word
function position(int24 tick)
    internal pure returns (int16 wordPos, uint8 bitPos);

/// @notice Toggles the initialized state of a tick
function flipTick(
    mapping(int16 => uint256) storage self,
    int24 tick,
    int24 tickSpacing
) internal;

/// @notice Finds the next initialized tick within the same word
function nextInitializedTickWithinOneWord(
    mapping(int16 => uint256) storage self,
    int24 tick,
    int24 tickSpacing,
    bool lte
) internal view returns (int24 next, bool initialized);
```

### Search Behavior

When `lte = true` (selling token0, price decreasing):
- Searches **at and to the left** of the current compressed tick
- The current tick's bit IS included in the search

When `lte = false` (selling token1, price increasing):
- Searches **to the right** of the current compressed tick
- Starts at `compressed + 1`, so the current tick is excluded

If no initialized tick is found in the current word, returns the boundary of the word. The swap loop then advances to the next word.

## Position Library

**Import:** `import {Position} from "v4-core/src/libraries/Position.sol";`

### Position State

```solidity
struct State {
    uint128 liquidity;
    uint256 feeGrowthInside0LastX128;
    uint256 feeGrowthInside1LastX128;
}
```

### Position Key

In V4, positions are identified by a `bytes32` key derived from owner, tick range, and salt:

```solidity
function calculatePositionKey(
    address owner,
    int24 tickLower,
    int24 tickUpper,
    bytes32 salt
) internal pure returns (bytes32 positionKey);
```

The `salt` parameter (new in V4) allows a single address to hold multiple distinct positions at the same tick range. In V3, `positionKey = keccak256(abi.encodePacked(owner, tickLower, tickUpper))`.

### Updating a Position

```solidity
function update(
    State storage self,
    int128 liquidityDelta,
    uint256 feeGrowthInside0X128,
    uint256 feeGrowthInside1X128
) internal returns (uint256 feesOwed0, uint256 feesOwed1);
```

Collects accrued fees and applies the liquidity change. The returned `feesOwed` values represent tokens owed to the position owner.

## LiquidityAmounts (Periphery)

**Import:** `import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";`

This is a periphery helper (not in core). It computes how much liquidity you get for a given token deposit, or how many tokens correspond to a given liquidity amount.

### Functions

```solidity
function getLiquidityForAmount0(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    uint256 amount0
) internal pure returns (uint128 liquidity);

function getLiquidityForAmount1(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    uint256 amount1
) internal pure returns (uint128 liquidity);

function getLiquidityForAmounts(
    uint160 sqrtPriceX96,
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    uint256 amount0,
    uint256 amount1
) internal pure returns (uint128 liquidity);

function getAmount0ForLiquidity(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    uint128 liquidity
) internal pure returns (uint256 amount0);

function getAmount1ForLiquidity(
    uint160 sqrtPriceAX96,
    uint160 sqrtPriceBX96,
    uint128 liquidity
) internal pure returns (uint256 amount1);
```

### Three Regimes for getLiquidityForAmounts

Given current price `P`, position range `[P_a, P_b]`:

**Case 1: P < P_a** — price is below range, position is entirely token0.

```
liquidity = getLiquidityForAmount0(√P_a, √P_b, amount0)
           = amount0 × √P_a × √P_b / (√P_b - √P_a)
```

**Case 2: P_a ≤ P ≤ P_b** — price is inside range, position holds both tokens.

```
L0 = getLiquidityForAmount0(√P, √P_b, amount0)
L1 = getLiquidityForAmount1(√P_a, √P, amount1)
liquidity = min(L0, L1)
```

The binding constraint determines the actual liquidity. Excess of the other token is not used.

**Case 3: P > P_b** — price is above range, position is entirely token1.

```
liquidity = getLiquidityForAmount1(√P_a, √P_b, amount1)
           = amount1 / (√P_b - √P_a)
```

### Formulas

```
From token0:  L = amount0 × √P_a × √P_b / (√P_b - √P_a)
From token1:  L = amount1 / (√P_b - √P_a)

To token0:    amount0 = L × (√P_b - √P_a) / (√P_a × √P_b)
To token1:    amount1 = L × (√P_b - √P_a)
```

## Fee Accounting

### Global Fee Accumulators

```solidity
uint256 feeGrowthGlobal0X128;  // cumulative fee per unit liquidity for token0
uint256 feeGrowthGlobal1X128;  // cumulative fee per unit liquidity for token1
```

These are Q128.128 fixed-point values that increase monotonically. Each swap adds:

```
feeGrowthGlobal0X128 += feeAmount0 × 2¹²⁸ / activeLiquidity
```

### Per-Tick Fee Tracking

Each initialized tick stores `feeGrowthOutside{0,1}X128`. By convention, "outside" means the side that the current tick is NOT on relative to the tick in question.

```
feeGrowthBelow(tick_i):
  if currentTick >= tick_i:
    return tick_i.feeGrowthOutside
  else:
    return feeGrowthGlobal - tick_i.feeGrowthOutside

feeGrowthAbove(tick_i):
  if currentTick < tick_i:
    return tick_i.feeGrowthOutside
  else:
    return feeGrowthGlobal - tick_i.feeGrowthOutside
```

### Fee Growth Inside a Range

```
feeGrowthInside[tickLower, tickUpper] =
    feeGrowthGlobal - feeGrowthBelow(tickLower) - feeGrowthAbove(tickUpper)
```

### Fees Owed to a Position

```solidity
feesOwed0 = (feeGrowthInside0X128 - position.feeGrowthInside0LastX128)
            * position.liquidity / 2**128;

feesOwed1 = (feeGrowthInside1X128 - position.feeGrowthInside1LastX128)
            * position.liquidity / 2**128;
```

The subtraction relies on uint256 wrapping — this works correctly even if `feeGrowthInside` has wrapped around, as long as fees accrued in a single position's lifetime don't exceed 2²⁵⁶.

## Worked Examples

### Example 1: sqrtPriceX96 for ETH/USDC at $3000

```
Assumptions:
  token0 = WETH (18 decimals)
  token1 = USDC (6 decimals)
  Human price: 1 ETH = 3000 USDC

Step 1: Raw price in token units
  price = 3000 × 10⁶ / 10¹⁸ = 3 × 10⁻⁹

Step 2: Square root
  √price = √(3 × 10⁻⁹) = √3 × 10⁻⁴·⁵ ≈ 5.47722558 × 10⁻⁵

Step 3: Scale by 2⁹⁶
  sqrtPriceX96 = 5.47722558 × 10⁻⁵ × 79228162514264337593543950336
               ≈ 4_339_505_179_874_779_489_878_115

Step 4: Corresponding tick
  tick = log(3 × 10⁻⁹) / log(1.0001) ≈ -196222

Verification: TickMath.getSqrtPriceAtTick(-196222) should be ≈ sqrtPriceX96 above
```

### Example 2: Liquidity from Token Amounts

```
Scenario:
  Provide liquidity for ETH/USDC, range $2500-$3500
  Current price: $3000
  Deposit: 1 ETH + 3000 USDC

Step 1: Convert price bounds to ticks
  tickLower ≈ -198242  (corresponding to ~$2500)
  tickUpper ≈ -194626  (corresponding to ~$3500)

Step 2: Get sqrtPrices
  √P       = √(3000 × 10⁻¹²) × 2⁹⁶  (current, from Example 1)
  √P_lower = √(2500 × 10⁻¹²) × 2⁹⁶ ≈ 3_961_408_831_915_985_491_200_000
  √P_upper = √(3500 × 10⁻¹²) × 2⁹⁶ ≈ 4_689_982_010_565_498_048_200_000

Step 3: Compute L from each token
  L_from_ETH = amount0 × √P × √P_upper / (√P_upper - √P)
  L_from_USDC = amount1 / (√P - √P_lower) × 2⁹⁶

Step 4: Take the minimum
  liquidity = min(L_from_ETH, L_from_USDC)

Excess of the non-binding token is returned to the depositor.
```

### Example 3: Swap Output Calculation

```
Scenario:
  Swap 1 WETH for USDC in the ETH/USDC pool
  zeroForOne = true (selling token0/WETH)
  Current sqrtPriceX96 corresponds to $3000
  Pool has 10_000_000 units of liquidity in the current tick range
  Fee: 3000 (0.30%)

Step 1: Deduct fee from input
  effectiveInput = 1e18 × (1_000_000 - 3000) / 1_000_000
                 = 1e18 × 997000 / 1000000
                 = 997 × 10¹⁵

Step 2: Compute new sqrtPrice after consuming effectiveInput of token0
  √P_new = L × √P_old / (L + effectiveInput × √P_old)
  (price decreases because we're adding token0)

Step 3: Compute token1 output
  amount1Out = L × (√P_old - √P_new)

Step 4: If √P_new crosses a tick boundary, split the computation:
  - Compute partial swap to the tick boundary
  - Cross tick (adjust liquidity by tick's liquidityNet)
  - Continue with remaining input and new liquidity
```

### Example 4: Tick to Human-Readable Price

```
Given: tick = -196222, token0 = WETH (18 dec), token1 = USDC (6 dec)

Step 1: Raw price
  rawPrice = 1.0001^(-196222) ≈ 3.000 × 10⁻⁹

Step 2: Adjust for decimals
  humanPrice = rawPrice × 10^(decimals0 - decimals1)
             = 3.000 × 10⁻⁹ × 10^(18-6)
             = 3.000 × 10⁻⁹ × 10¹²
             = 3000

So tick -196222 ≈ $3000 ETH/USDC
```

```python
import math
def tick_to_price(tick, decimals0, decimals1):
    raw = 1.0001 ** tick
    return raw * 10 ** (decimals0 - decimals1)

def price_to_tick(price, decimals0, decimals1):
    raw = price / 10 ** (decimals0 - decimals1)
    return math.floor(math.log(raw) / math.log(1.0001))
```

### Example 5: Fee Accrual for an LP Position

```
Scenario:
  Position: liquidity = 5_000_000, range [tickLower, tickUpper]
  At position creation:
    position.feeGrowthInside0LastX128 = 100 × 2¹²⁸
    position.feeGrowthInside1LastX128 = 200 × 2¹²⁸

  After many swaps:
    feeGrowthInside0X128 = 150 × 2¹²⁸
    feeGrowthInside1X128 = 350 × 2¹²⁸

Fee calculation:
  feesOwed0 = (150 × 2¹²⁸ - 100 × 2¹²⁸) × 5_000_000 / 2¹²⁸
            = 50 × 5_000_000
            = 250_000_000  (in token0 smallest units)

  feesOwed1 = (350 × 2¹²⁸ - 200 × 2¹²⁸) × 5_000_000 / 2¹²⁸
            = 150 × 5_000_000
            = 750_000_000  (in token1 smallest units)
```

## V4 Import Paths

```solidity
// Core math libraries
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";
import {SwapMath} from "v4-core/src/libraries/SwapMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {FixedPoint128} from "v4-core/src/libraries/FixedPoint128.sol";
import {TickBitmap} from "v4-core/src/libraries/TickBitmap.sol";
import {Position} from "v4-core/src/libraries/Position.sol";
import {UnsafeMath} from "v4-core/src/libraries/UnsafeMath.sol";
import {BitMath} from "v4-core/src/libraries/BitMath.sol";

// Periphery helpers
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";

// Types
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
```

## FixedPoint96 and FixedPoint128

```solidity
// v4-core/src/libraries/FixedPoint96.sol
uint8 internal constant RESOLUTION = 96;
uint256 internal constant Q96 = 0x1000000000000000000000000; // 2^96

// v4-core/src/libraries/FixedPoint128.sol
uint256 internal constant Q128 = 0x100000000000000000000000000000000; // 2^128
```

- `Q96 = 2⁹⁶ = 79228162514264337593543950336` — used for sqrtPriceX96
- `Q128 = 2¹²⁸ = 340282366920938463463374607431768211456` — used for fee growth accumulators

## BitMath Library

**Import:** `import {BitMath} from "v4-core/src/libraries/BitMath.sol";`

```solidity
function mostSignificantBit(uint256 x) internal pure returns (uint8 r);
function leastSignificantBit(uint256 x) internal pure returns (uint8 r);
```

Used internally by `TickBitmap.nextInitializedTickWithinOneWord` to find set bits efficiently. `mostSignificantBit` is also used in `TickMath.getTickAtSqrtPrice` for the initial approximation.

## Common Pitfalls

### 1. Forgetting Decimal Normalization

Token0/token1 ordering and decimal differences change everything:

```solidity
// WRONG: assuming 18 decimals for all tokens
uint256 priceInUSD = (sqrtPriceX96 * sqrtPriceX96) >> 192;

// RIGHT: account for decimal difference
// For WETH(18)/USDC(6): multiply result by 10^12
uint256 rawPrice = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 192);
uint256 priceInUSD = rawPrice * 10 ** (18 - 6);
```

### 2. Off-by-One in Tick Rounding

`getTickAtSqrtPrice` floors to the largest tick ≤ the price. When computing a position range from a human price, always round tickLower DOWN and tickUpper UP (to the nearest usable tick) to ensure the range contains the target price:

```solidity
int24 rawTick = TickMath.getTickAtSqrtPrice(targetSqrtPrice);
int24 tickLower = (rawTick / tickSpacing) * tickSpacing;
if (rawTick < 0 && rawTick % tickSpacing != 0) {
    tickLower -= tickSpacing;  // round towards negative infinity
}
int24 tickUpper = tickLower + tickSpacing;
```

### 3. Rounding Direction Errors

Always match rounding to who benefits:

```solidity
// Collecting fees — user receives, round DOWN
uint256 fees = FullMath.mulDiv(delta, liquidity, FixedPoint128.Q128);

// Charging fees — user pays, round UP
uint256 fees = FullMath.mulDivRoundingUp(delta, liquidity, FixedPoint128.Q128);
```

### 4. Overflow in Intermediate Calculations

Never multiply two `uint160` or `uint256` values directly — use `FullMath.mulDiv`:

```solidity
// WRONG: overflows for large sqrtPriceX96 values
uint256 price = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) / (1 << 192);

// RIGHT: 512-bit intermediate
uint256 price = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 192);
```

### 5. Tick Spacing Alignment

Positions can only be placed at ticks divisible by `tickSpacing`. Passing unaligned ticks to `mint` reverts:

```solidity
// Verify alignment before creating positions
require(tickLower % tickSpacing == 0, "tickLower not aligned");
require(tickUpper % tickSpacing == 0, "tickUpper not aligned");
require(tickLower < tickUpper, "tickLower must be < tickUpper");
```

### 6. Liquidity Overflow

`uint128` liquidity can overflow with very large positions. The maximum liquidity per tick is bounded by the pool's `maxLiquidityPerTick`, which depends on tick spacing:

```solidity
// From Pool.tickSpacingToMaxLiquidityPerTick:
// tickSpacing=1   → maxLiq ≈ 1.91 × 10³⁷
// tickSpacing=60  → maxLiq ≈ 1.15 × 10³⁹
// tickSpacing=200 → maxLiq ≈ 3.83 × 10³⁹
```

### 7. Fee Growth Wrapping

Fee growth values can wrap around for tokens with very small decimals or very high volume. The subtraction `current - last` works correctly due to unsigned integer underflow semantics, but only if total fees accrued in a position's lifetime stay under 2²⁵⁶. This is not a practical concern.

### 8. sqrtPrice Bounds

The pool's `sqrtPriceX96` is always strictly within `(MIN_SQRT_PRICE, MAX_SQRT_PRICE)`. Passing values at or outside these bounds to pool functions will revert:

```solidity
// Valid price limits for swaps
uint160 priceLimit = zeroForOne
    ? TickMath.MIN_SQRT_PRICE + 1  // just above minimum
    : TickMath.MAX_SQRT_PRICE - 1; // just below maximum
```

## Checklist

- [ ] Decimal differences between token0 and token1 are accounted for in all price conversions
- [ ] `FullMath.mulDiv` used for all intermediate multiplications that may overflow uint256
- [ ] Rounding direction matches economic intent (pay UP, receive DOWN)
- [ ] Tick values are aligned to pool's tick spacing before use
- [ ] `sqrtPriceLimitX96` is strictly within `(MIN_SQRT_PRICE, MAX_SQRT_PRICE)`
- [ ] Fee accumulator math uses uint256 wrapping subtraction correctly
- [ ] `LiquidityAmounts` regime (below/inside/above range) is handled for the current price
- [ ] Token0/token1 ordering verified (`token0 < token1` by address)
- [ ] Position key includes salt parameter in V4 (not just owner + ticks)
- [ ] `getTickAtSqrtPrice` floor behavior accounted for in range boundary calculations
