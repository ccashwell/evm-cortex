---
name: lp-analyst
description: Use when analyzing LP positions, calculating impermanent loss, optimizing position ranges, estimating fee revenue, rebalancing strategies, or building automated liquidity management. Covers both Uniswap V3 NonfungiblePositionManager and V4 PositionManager positions.
---

# LP Position Analysis

## Impermanent Loss Mathematics

### V2 Full-Range IL

For a 50/50 constant-product pool where `r = current_price / entry_price`:

```
IL(r) = 2√r / (1 + r) - 1
```

| Price Change | r | IL |
|-------------|-----|---------|
| -50% | 0.50 | -5.72% |
| -25% | 0.75 | -1.03% |
| -10% | 0.90 | -0.14% |
| 0% | 1.00 | 0.00% |
| +10% | 1.10 | -0.14% |
| +25% | 1.25 | -0.62% |
| +50% | 1.50 | -2.02% |
| +100% | 2.00 | -5.72% |
| +300% | 4.00 | -20.00% |

IL is always non-positive. The loss is symmetric on a log scale: a 2x and a 0.5x move produce the same IL.

### V3 Concentrated Liquidity IL

For a position with tick range `[tickLower, tickUpper]` mapping to price range `[Pa, Pb]` where `Pa < Pb`, with liquidity `L` and current price `P`:

**Position token amounts (the core V3 math):**

```
If Pa ≤ P ≤ Pb (in range):
  amount0 = L × (1/√P - 1/√Pb)
  amount1 = L × (√P - √Pa)

If P < Pa (below range — 100% token0):
  amount0 = L × (1/√Pa - 1/√Pb)
  amount1 = 0

If P > Pb (above range — 100% token1):
  amount0 = 0
  amount1 = L × (√Pb - √Pa)
```

**Position value in token1 terms:**

```
value(P) = amount0 × P + amount1
```

Expanding for the in-range case:

```
value(P) = L × (P/√P - P/√Pb + √P - √Pa)
         = L × (√P - √Pa + √P - P/√Pb)
         = L × (2√P - √Pa - P/√Pb)
```

**HODL value** (holding the initial token amounts without providing liquidity):

At entry price `P₀` (in range), the initial amounts are:

```
a0 = L × (1/√P₀ - 1/√Pb)
a1 = L × (√P₀ - √Pa)
```

HODL value at current price `P`:

```
value_HODL(P) = a0 × P + a1
              = L × (P/√P₀ - P/√Pb + √P₀ - √Pa)
```

**Impermanent loss:**

```
IL = value_LP(P) / value_HODL(P) - 1
```

Concentrated positions amplify IL relative to V2. The amplification factor equals the capital efficiency multiplier.

### Worked Example: ETH/USDC

Setup:
- Entry price: P₀ = 3000 USDC/ETH
- Range: Pa = 2500, Pb = 3500
- Deposit: 1 ETH + 3000 USDC worth of value

Compute initial amounts (P₀ = 3000, in range):

```
√3000 ≈ 54.772
√2500 = 50.000
√3500 ≈ 59.161

Liquidity L from 1 ETH + equivalent USDC:
  From token0: L = amount0 / (1/√P - 1/√Pb)
  From token1: L = amount1 / (√P - √Pa)

Using the ratio to find L for a balanced deposit of value V at price P₀:
  V = L × (2√P₀ - √Pa - P₀/√Pb)
  V = L × (2 × 54.772 - 50.000 - 3000/59.161)
  V = L × (109.544 - 50.000 - 50.709)
  V = L × 8.835

For V = 6000 USDC (1 ETH at $3000 + 3000 USDC):
  L = 6000 / 8.835 ≈ 679.0
```

Now ETH moves to $3500 (upper bound):

```
P = 3500 = Pb → position is 100% USDC (token1)

amount0 = 0
amount1 = L × (√Pb - √Pa) = 679.0 × (59.161 - 50.000) = 679.0 × 9.161 ≈ 6220

value_LP = 6220 USDC
```

HODL value at $3500:

```
Initial amounts at P₀ = 3000:
  a0 = 679.0 × (1/54.772 - 1/59.161) = 679.0 × (0.01826 - 0.01690) = 679.0 × 0.001359 ≈ 0.923 ETH
  a1 = 679.0 × (54.772 - 50.000) = 679.0 × 4.772 ≈ 3240 USDC

value_HODL = 0.923 × 3500 + 3240 = 3230 + 3240 = 6470 USDC
```

Impermanent loss:

```
IL = 6220 / 6470 - 1 ≈ -3.86%
```

Compare with V2 full-range IL at the same price move (r = 3500/3000 ≈ 1.167):

```
IL_v2 = 2√1.167 / (1 + 1.167) - 1 = 2 × 1.0801 / 2.167 - 1 ≈ -0.28%
```

The concentrated position suffers ~14x more IL — consistent with the capital efficiency multiplier for this range.

## Fee Revenue Estimation

### Fee Accrual Model

```
fee_revenue = volume_in_range × fee_tier × (position_liquidity / total_liquidity_in_range)
```

Annualized:

```
annual_fees = daily_fee_revenue × 365
fee_APR = annual_fees / position_value
```

The net return of an LP position is:

```
net_return = fee_APR + IL
```

A position is profitable when fee revenue exceeds IL.

### Fee Tiers

| Tier | Fee | Tick Spacing | Typical Pairs |
|------|-----|-------------|---------------|
| 0.01% | 100 | 1 | Stablecoin/stablecoin (USDC/USDT) |
| 0.05% | 500 | 10 | Correlated assets (wstETH/ETH) |
| 0.30% | 3000 | 60 | Standard pairs (ETH/USDC) |
| 1.00% | 10000 | 200 | Exotic / long-tail pairs |

### Active Time Ratio

Concentrated positions only earn fees while the current price is within range. The active time ratio `α` represents the fraction of time the position is in range:

```
effective_fee_APR = fee_APR × α
```

For a ±10% range on ETH/USDC, historical α is typically 60-80% over a month. Narrower ranges have lower α.

### Fee Growth Tracking (V3)

Uniswap V3 tracks cumulative fees per unit of liquidity using Q128.128 fixed-point accumulators:

```
feeGrowthGlobal0X128  — cumulative token0 fees per unit liquidity (pool-wide)
feeGrowthGlobal1X128  — cumulative token1 fees per unit liquidity (pool-wide)
```

Per-position uncollected fees:

```
uncollected0 = (feeGrowthInside0CurrentX128 - feeGrowthInside0LastX128) × liquidity / 2^128
uncollected1 = (feeGrowthInside1CurrentX128 - feeGrowthInside1LastX128) × liquidity / 2^128
```

Where `feeGrowthInsideX128` is computed from the tick-level `feeGrowthOutside` values:

```solidity
// Pseudocode for feeGrowthInside
if currentTick >= tickUpper:
    feeGrowthInside = feeGrowthOutside[tickUpper] - feeGrowthOutside[tickLower]
elif currentTick < tickLower:
    feeGrowthInside = feeGrowthOutside[tickLower] - feeGrowthOutside[tickUpper]
else:
    feeGrowthInside = feeGrowthGlobal - feeGrowthOutside[tickLower] - feeGrowthOutside[tickUpper]
```

## Position Range Optimization

### Capital Efficiency Multiplier

For a range `[Pa, Pb]`, capital efficiency relative to full range is:

```
efficiency = 1 / (1 - √(Pa / Pb))
```

| Range | Pa/Pb | Efficiency |
|-------|-------|-----------|
| ±0.1% (stables) | 0.998 | ~1000x |
| ±1% | 0.980 | ~100x |
| ±5% | 0.905 | ~19x |
| ±10% | 0.818 | ~5.2x |
| ±25% | 0.600 | ~3.8x |
| ±50% | 0.333 | ~2.2x |
| Full range | 0→∞ | 1x |

Higher efficiency means more fees earned per dollar of capital, but also more IL per dollar and more frequent out-of-range events.

### Range Selection Heuristics

**Stablecoin pairs (USDC/USDT):**
- Range: ±0.05% to ±0.5% around peg
- Fee tier: 0.01%
- Rebalance: rarely needed if peg holds
- Capital efficiency: 200x–2000x

**Correlated pairs (wstETH/ETH):**
- Range: ±1% to ±5%
- Fee tier: 0.05%
- Rebalance: weekly or when staking rate changes materially
- Capital efficiency: 20x–100x

**Major pairs (ETH/USDC):**
- Range: ±10% to ±30% based on volatility regime
- Fee tier: 0.30%
- Rebalance: when price approaches range boundary
- Capital efficiency: 3x–10x

**Volatile pairs (memecoins, new tokens):**
- Range: ±50% or wider
- Fee tier: 1.00%
- Rebalance: avoid — gas often exceeds benefit
- Capital efficiency: 1.5x–3x

### Tick Math

Prices map to ticks via:

```
tick = floor(log(price) / log(1.0001))
price = 1.0001^tick
```

Tick spacing constrains which ticks can be used. A position's range must align to the pool's tick spacing:

```
tickLower = floor(desired_tick / tickSpacing) × tickSpacing
tickUpper = ceil(desired_tick / tickSpacing) × tickSpacing
```

## Reading Positions Onchain

### V3 NonfungiblePositionManager

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {INonfungiblePositionManager} from "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

interface IPositionReader {
    function analyzePosition(uint256 tokenId) external view returns (
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );
}

contract V3PositionReader {
    INonfungiblePositionManager public immutable NPM;

    constructor(address npm_) {
        NPM = INonfungiblePositionManager(npm_);
    }

    function getPosition(uint256 tokenId) external view returns (
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    ) {
        (
            ,              // nonce
            ,              // operator
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            liquidity,
            feeGrowthInside0LastX128,
            feeGrowthInside1LastX128,
            tokensOwed0,
            tokensOwed1
        ) = NPM.positions(tokenId);
    }
}
```

### V4 PositionManager

```solidity
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PositionInfo} from "v4-periphery/src/libraries/PositionInfoLibrary.sol";

contract V4PositionReader {
    IPositionManager public immutable PM;

    constructor(address pm_) {
        PM = IPositionManager(pm_);
    }

    /// @notice Reads a V4 LP position's pool key, tick range, and liquidity
    function getPosition(uint256 tokenId) external view returns (
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) {
        PositionInfo info;
        (poolKey, info) = PM.getPoolAndPositionInfo(tokenId);
        tickLower = info.tickLower();
        tickUpper = info.tickUpper();
        liquidity = PM.getPositionLiquidity(tokenId);
    }
}
```

### Converting Ticks to Prices

```solidity
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Convert a tick to a human-readable price
/// @dev price = 1.0001^tick, adjusted for token decimals
function tickToPrice(int24 tick, uint8 decimals0, uint8 decimals1) pure returns (uint256) {
    uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
    // price = (sqrtPriceX96 / 2^96)^2 × 10^(decimals0 - decimals1)
    uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
    return priceX192 * (10 ** decimals0) / (10 ** decimals1) >> 192;
}
```

## Position Value Calculation

### Token Amounts from Liquidity

```solidity
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Calculate the token amounts for a position
function getAmounts(
    int24 tickCurrent,
    int24 tickLower,
    int24 tickUpper,
    uint128 liquidity
) pure returns (uint256 amount0, uint256 amount1) {
    uint160 sqrtPriceCurrent = TickMath.getSqrtPriceAtTick(tickCurrent);
    uint160 sqrtPriceLower = TickMath.getSqrtPriceAtTick(tickLower);
    uint160 sqrtPriceUpper = TickMath.getSqrtPriceAtTick(tickUpper);

    (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
        sqrtPriceCurrent,
        sqrtPriceLower,
        sqrtPriceUpper,
        liquidity
    );
}
```

### Value in USD Terms

```
value_usd = amount0 × price0_usd + amount1 × price1_usd
```

For ETH/USDC where token0 = USDC, token1 = WETH:

```
value_usd = amount0 × 1.0 + amount1 × eth_price_usd
```

Always check token ordering — V3/V4 enforce `token0 < token1` by address sort.

## Fee Collection

### V3 Fee Collection

The NonfungiblePositionManager accumulates fees internally. To collect, first poke the position to update fee accounting, then call `collect`:

```solidity
/// @notice Collect all accrued fees from a V3 position
/// @dev A zero-liquidity decrease pokes the position to update fee snapshots
function collectFees(
    INonfungiblePositionManager npm,
    uint256 tokenId
) external returns (uint256 collected0, uint256 collected1) {
    npm.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams({
        tokenId: tokenId,
        liquidity: 0,
        amount0Min: 0,
        amount1Min: 0,
        deadline: block.timestamp
    }));

    (collected0, collected1) = npm.collect(INonfungiblePositionManager.CollectParams({
        tokenId: tokenId,
        recipient: msg.sender,
        amount0Max: type(uint128).max,
        amount1Max: type(uint128).max
    }));
}
```

### V4 Fee Collection

V4 positions collect fees through the `PositionManager.collect` action inside a multicall/modifyLiquidities batch. Fees settle through the PoolManager's transient accounting.

## Rebalancing Strategies

### Time-Based

Rebalance at fixed intervals (e.g., every 24 hours, every 7 days). Simple to implement with Chainlink Automation or Gelato tasks.

**Pros:** predictable gas spend, simple logic
**Cons:** rebalances even when unnecessary, misses urgent rebalances when price moves fast

### Price-Based (Threshold Trigger)

Rebalance when price exits the current range or approaches a boundary within a configurable buffer:

```
trigger_lower = Pa + buffer
trigger_upper = Pb - buffer
```

When `P < trigger_lower` or `P > trigger_upper`, close the position and re-open centered at the current price.

**Pros:** responsive to market conditions, avoids unnecessary rebalances
**Cons:** can trigger excessively during high volatility

### IL-Threshold

Monitor unrealized IL and rebalance when it exceeds a target percentage:

```
if |IL| > threshold:
    rebalance()
```

Typical thresholds: 1-3% for stablecoin pairs, 5-10% for major pairs.

### Geometric Mean Centering

Center the position at the geometric mean of recent prices to minimize expected IL:

```
P_center = exp(mean(ln(P_1), ln(P_2), ..., ln(P_n)))
Pa = P_center / k
Pb = P_center × k
```

Where `k` is the range multiplier (e.g., k = 1.1 for a ±10% range).

### Bollinger Band Range

Set the range dynamically based on historical volatility:

```
μ = SMA(price, window)
σ = StdDev(price, window)

Pa = μ - k × σ
Pb = μ + k × σ
```

With k = 2 (95% confidence), the position captures most price action. Wider `k` means less rebalancing but lower capital efficiency.

### Rebalance Cost-Benefit Analysis

A rebalance is only worth executing if the expected gain exceeds costs:

```
expected_benefit = additional_fee_revenue + avoided_IL
cost = gas_cost + swap_slippage + swap_fees + position_entry_spread

rebalance if: expected_benefit > cost
```

On L2s (Arbitrum, Base, Optimism) gas costs are negligible, making more frequent rebalances viable. On mainnet with gas at <1 gwei (2026), rebalancing is also cheaper than historically but still requires slippage/fee accounting.

## Automated Liquidity Management

### Keeper-Based Rebalancing

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AutomationCompatibleInterface} from
    "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";

/// @title LP position rebalancer using Chainlink Automation
/// @notice Monitors a V3 position and rebalances when price exits range
abstract contract LPKeeper is AutomationCompatibleInterface {
    uint256 public positionTokenId;
    uint256 public bufferBps;

    function checkUpkeep(bytes calldata)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        (int24 tickLower, int24 tickUpper, int24 tickCurrent) = _getPositionTicks();

        int24 rangeTicks = tickUpper - tickLower;
        int24 buffer = int24(int256(rangeTicks) * int256(uint256(bufferBps)) / 10_000);

        upkeepNeeded = tickCurrent <= tickLower + buffer || tickCurrent >= tickUpper - buffer;
        performData = abi.encode(tickCurrent);
    }

    function performUpkeep(bytes calldata performData) external override {
        int24 tickCurrent = abi.decode(performData, (int24));
        _rebalanceAroundTick(tickCurrent);
    }

    function _getPositionTicks() internal view virtual returns (int24, int24, int24);
    function _rebalanceAroundTick(int24 tick) internal virtual;
}
```

### V4 Auto-Compound Hook

A V4 hook can auto-compound fees into the position on every swap:

```solidity
function afterSwap(
    address,
    PoolKey calldata key,
    IPoolManager.SwapParams calldata,
    BalanceDelta delta,
    bytes calldata
) external override returns (bytes4, int128) {
    // Collect fees generated by the swap and re-add as liquidity
    // This is possible because V4 hooks execute within the PoolManager's
    // unlock context, allowing atomic fee collection + liquidity addition
    return (BaseHook.afterSwap.selector, 0);
}
```

### JIT (Just-In-Time) Liquidity

JIT liquidity adds a large concentrated position immediately before a swap and removes it after, capturing the swap fee on a narrow range. In V4, this can be implemented as a hook:

1. `beforeSwap`: mint concentrated liquidity at the current tick ± 1 tick spacing
2. The swap executes against this highly concentrated liquidity
3. `afterSwap`: burn the position, collect fees

JIT liquidity is MEV-adjacent — it competes with other LPs for fee revenue without taking price risk.

### ERC-4626 LP Vault

Wrap Uniswap LP positions in an ERC-4626 vault for composability:

```solidity
/// @title Uniswap V3 LP Vault
/// @notice ERC-4626 vault that manages a concentrated liquidity position
/// @dev Depositors receive vault shares proportional to their contribution
abstract contract LPVault {
    // vault share accounting
    // deposit: add liquidity to position, mint shares
    // withdraw: remove liquidity proportionally, burn shares
    // compound: collect fees, re-add as liquidity
    // rebalance: close position, re-open at new range
}
```

Key considerations:
- Share pricing must account for both token amounts and uncollected fees
- Rebalance triggers need governance or keeper access control
- Slippage protection on all swaps during rebalance
- Vault tokens should be non-rebasing (track shares, not token amounts)

## Analytics Queries

### Subgraph: Position Performance

```graphql
{
  position(id: "tokenId") {
    id
    owner
    liquidity
    depositedToken0
    depositedToken1
    withdrawnToken0
    withdrawnToken1
    collectedFeesToken0
    collectedFeesToken1
    pool {
      token0 { symbol decimals }
      token1 { symbol decimals }
      feeTier
      sqrtPrice
      tick
    }
    tickLower { tickIdx }
    tickUpper { tickIdx }
  }
}
```

### Subgraph: Pool Volume by Tick Range

```graphql
{
  poolDayDatas(
    where: { pool: "poolAddress" }
    orderBy: date
    orderDirection: desc
    first: 30
  ) {
    date
    volumeUSD
    tvlUSD
    feesUSD
    tick
  }
}
```

### Fee APR Calculation from Subgraph Data

```
daily_fees_usd = sum(feesUSD over 24h for ticks in [tickLower, tickUpper])
position_share = position_liquidity / total_liquidity_in_tick_range
my_daily_fees = daily_fees_usd × position_share
fee_APR = (my_daily_fees / position_value_usd) × 365
```

### Volume-to-Liquidity Ratio

Higher V/L ratio means more fee revenue per unit of liquidity:

```
VL_ratio = volume_24h / TVL_in_range
expected_daily_yield = VL_ratio × fee_tier
```

## Risk Metrics

### IL Sensitivity

Measure how IL changes per 1% price move:

```
IL_sensitivity = dIL/dr at r = 1

For V2: dIL/dr = (1 - √r) / (1 + r)^2
At r = 1: dIL/dr = 0 (IL is locally flat at entry)

Second derivative: d²IL/dr² = -(3 + r) / (4√r × (1 + r)^3)
At r = 1: d²IL/dr² = -1/4

IL ≈ -(Δr)² / 8 for small moves
```

For concentrated positions, multiply by the capital efficiency factor.

### Breakeven Fee APR

The minimum fee APR needed to offset IL over a given period:

```
breakeven_APR = -IL / holding_period_in_years
```

For the ETH/USDC example above (IL = -3.86% when ETH goes from $3000 to $3500):

```
If the move happened over 30 days:
breakeven_APR = 0.0386 / (30/365) ≈ 46.97%
```

### Maximum Drawdown

For a concentrated position `[Pa, Pb]` entered at price `P₀`:

```
If price crashes to Pa:
  max_drawdown_below = value(Pa) / value(P₀) - 1

If price spikes to Pb:
  max_drawdown_above = value(Pb) / value(P₀) - 1
```

Out-of-range positions experience the worst-case: the position becomes 100% of the depreciating token (below range) or 100% of the appreciating token you no longer hold (above range).

### Volatility-IL Relationship

For a token with annualized volatility `σ` and a holding period `t` (in years):

```
Expected IL (V2) ≈ -σ²t / 8
```

Derivation: price follows geometric Brownian motion, `ln(r)` is normally distributed with variance `σ²t`, and the second-order Taylor expansion of IL gives the `-σ²/8` coefficient.

For concentrated positions with efficiency multiplier `E`:

```
Expected IL (V3) ≈ -E × σ²t / 8
```

### Position Duration vs Profitability

Longer positions in range accumulate more fees. The crossover point where fees exceed IL depends on:

```
t_breakeven = |IL| / fee_rate_per_unit_time
```

Empirically for ETH/USDC 0.30% tier with ±10% range:
- < 7 days: fees unlikely to offset IL during volatile periods
- 7-30 days: breakeven zone
- > 30 days: fees typically dominate if position stays in range

## Checklist

- [ ] Verify token ordering (`token0 < token1` by address) before interpreting amounts
- [ ] Account for decimal differences when computing USD values (USDC = 6, WETH = 18)
- [ ] Use `SafeERC20` for all token transfers in LP management contracts
- [ ] Include slippage protection (`amount0Min`, `amount1Min`) on all liquidity operations
- [ ] Track fee growth snapshots (`feeGrowthInside0LastX128`) for accurate fee accounting
- [ ] Validate tick alignment to pool's tick spacing before creating positions
- [ ] Compare rebalance cost (gas + slippage + fees) against expected benefit before executing
- [ ] Test with forked mainnet to verify against real pool state and liquidity depth
- [ ] Handle edge cases: zero liquidity, position fully out of range, pool not initialized
- [ ] For V4: ensure all position modifications happen within `PoolManager.unlock()` context
