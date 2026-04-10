---
name: pool-finder
description: Use when discovering Uniswap pools, querying pool state, analyzing TVL/volume, finding optimal swap routes, or inspecting pool parameters. Covers V3 Factory queries, V4 PoolManager state, subgraph queries, and cast/forge inspection commands.
---

# Uniswap Pool Discovery & Analysis

## Key Addresses (Ethereum Mainnet)

| Contract | Address |
|----------|---------|
| V3 Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| V3 QuoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |
| V3 SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` |
| V3 NonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` |
| V4 PoolManager | `0x000000000004444c5dc75cb358380d2e3de08a90` |

## V3 Pool Discovery

### Factory Query

```solidity
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

IUniswapV3Factory factory = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

// Fee tiers and their tick spacings:
//   100  (0.01%) — tickSpacing 1   — stablecoin pairs
//   500  (0.05%) — tickSpacing 10  — correlated pairs, high volume
//   3000 (0.30%) — tickSpacing 60  — standard pairs
//  10000 (1.00%) — tickSpacing 200 — exotic / low-volume pairs
address pool = factory.getPool(tokenA, tokenB, fee);
```

### Using cast

```bash
# Find ETH/USDC 0.3% pool on Ethereum mainnet
cast call 0x1F98431c8aD98523631AE4a59f267346ea31F984 \
  "getPool(address,address,uint24)(address)" \
  0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  3000

# Read pool slot0 — returns (sqrtPriceX96, tick, observationIndex, observationCardinality,
#   observationCardinalityNext, feeProtocol, unlocked)
cast call <pool_address> "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)"

# Active liquidity in the current tick range
cast call <pool_address> "liquidity()(uint128)"

# Pool configuration
cast call <pool_address> "fee()(uint24)"
cast call <pool_address> "tickSpacing()(int24)"
cast call <pool_address> "token0()(address)"
cast call <pool_address> "token1()(address)"

# Oracle observation buffer size
cast call <pool_address> "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" | \
  awk '{print "observationCardinality:", $4}'
```

### Scanning All Fee Tiers

```bash
FACTORY=0x1F98431c8aD98523631AE4a59f267346ea31F984
TOKEN_A=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2  # WETH
TOKEN_B=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48  # USDC

for FEE in 100 500 3000 10000; do
  POOL=$(cast call $FACTORY "getPool(address,address,uint24)(address)" $TOKEN_A $TOKEN_B $FEE)
  if [ "$POOL" != "0x0000000000000000000000000000000000000000" ]; then
    LIQ=$(cast call $POOL "liquidity()(uint128)")
    echo "Fee: $FEE  Pool: $POOL  Liquidity: $LIQ"
  fi
done
```

## V3 High-Volume Pools (Ethereum Mainnet)

```
ETH/USDC 0.05%:  0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640
ETH/USDC 0.30%:  0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8
ETH/USDT 0.05%:  0x11b815efB8f581194ae79006d24E0d814B7697F6
ETH/USDT 0.30%:  0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36
WBTC/ETH 0.30%:  0xCBCdF9626bC03E24f779434178A73a0B4bad62eD
WBTC/ETH 0.05%:  0x4585FE77225b41b697C938B018E2Ac67Ac5a20c0
USDC/USDT 0.01%: 0x3416cF6C708Da44DB2624D63ea0AAef7113527C6
DAI/USDC 0.01%:  0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168
DAI/USDC 0.05%:  0x6c6Bc977E13Df9b0de53b251522280BB72383700
```

## V4 Pool Discovery

V4 pools do not have individual addresses. All pool state lives inside the singleton PoolManager. A pool is identified by its `PoolKey`, hashed into a `PoolId`.

### PoolKey Construction

```solidity
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

using PoolIdLibrary for PoolKey;

// currency0 MUST be numerically less than currency1
PoolKey memory key = PoolKey({
    currency0: Currency.wrap(token0),
    currency1: Currency.wrap(token1),
    fee: 3000,                          // or LPFeeLibrary.DYNAMIC_FEE_FLAG for hook-managed fees
    tickSpacing: 60,
    hooks: IHooks(hookAddress)          // address(0) for vanilla pool
});

PoolId id = key.toId(); // keccak256(abi.encode(key))
```

### Currency Ordering

V4 enforces `currency0 < currency1`. Native ETH is represented as `Currency.wrap(address(0))`, which sorts below any ERC-20 address. For two ERC-20 tokens, the one with the numerically smaller address is `currency0`.

```solidity
function orderCurrencies(address a, address b) pure returns (Currency c0, Currency c1) {
    (c0, c1) = a < b
        ? (Currency.wrap(a), Currency.wrap(b))
        : (Currency.wrap(b), Currency.wrap(a));
}
```

### Reading V4 Pool State with cast

```bash
POOL_MANAGER=0x000000000004444c5dc75cb358380d2e3de08a90

# Get slot0: (sqrtPriceX96, tick, protocolFee, lpFee)
cast call $POOL_MANAGER \
  "getSlot0(bytes32)(uint160,int24,uint24,uint24)" \
  <pool_id>

# Get active liquidity
cast call $POOL_MANAGER \
  "getLiquidity(bytes32)(uint128)" \
  <pool_id>

# Get liquidity at a specific tick
cast call $POOL_MANAGER \
  "getTickLiquidity(bytes32,int24)(uint128,int128)" \
  <pool_id> <tick>

# Get tick bitmap word
cast call $POOL_MANAGER \
  "getTickBitmap(bytes32,int16)(uint256)" \
  <pool_id> <word_position>
```

### Computing a PoolId Offchain

```bash
# Encode the PoolKey struct and hash it
cast keccak $(cast abi-encode \
  "(address,address,uint24,int24,address)" \
  <currency0> <currency1> <fee> <tickSpacing> <hooks>)
```

## Subgraph Queries

### V3 Subgraph Endpoints

| Network | Subgraph ID |
|---------|-------------|
| Ethereum | `5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV` |
| Base | `43Hwfi3dJSoGpyas9VwNoDAv55yjgGrPpNSmbQZArzMG` |
| Arbitrum | `FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM` |
| Optimism | `Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj` |
| Polygon | `3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm` |

Endpoint format: `https://gateway.thegraph.com/api/[api-key]/subgraphs/id/<subgraph-id>`

### Top Pools by TVL

```graphql
{
  pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id
    token0 { symbol decimals id }
    token1 { symbol decimals id }
    feeTier
    liquidity
    sqrtPrice
    tick
    totalValueLockedUSD
    volumeUSD
    txCount
  }
}
```

### Find Pools for a Specific Token

```graphql
{
  pools(
    where: {
      or: [
        { token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }
        { token1: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }
      ]
    }
    orderBy: totalValueLockedUSD
    orderDirection: desc
    first: 5
  ) {
    id
    token0 { symbol }
    token1 { symbol }
    feeTier
    totalValueLockedUSD
    volumeUSD
  }
}
```

### Tick-Level Liquidity Distribution

```graphql
{
  ticks(
    where: { pool: "<pool_id>" }
    first: 1000
    orderBy: tickIdx
  ) {
    tickIdx
    liquidityNet
    liquidityGross
  }
}
```

### Active Positions

```graphql
{
  positions(
    where: { pool: "<pool_id>", liquidity_gt: "0" }
    first: 100
    orderBy: liquidity
    orderDirection: desc
  ) {
    id
    owner
    tickLower { tickIdx }
    tickUpper { tickIdx }
    liquidity
    depositedToken0
    depositedToken1
    collectedFeesToken0
    collectedFeesToken1
  }
}
```

### Historical Volume (Daily Snapshots)

```graphql
{
  poolDayDatas(
    where: { pool: "<pool_id>" }
    orderBy: date
    orderDirection: desc
    first: 30
  ) {
    date
    volumeUSD
    tvlUSD
    feesUSD
    liquidity
    sqrtPrice
    tick
    open
    high
    low
    close
  }
}
```

## Optimal Route Finding

### Comparing Fee Tiers

Always query all fee tiers for a pair. The deepest liquidity at the current tick determines the best execution:

```solidity
import {IQuoterV2} from "@uniswap/v3-periphery/contracts/interfaces/IQuoterV2.sol";

IQuoterV2 quoter = IQuoterV2(0x61fFE014bA17989E743c5F6cB21bF9697530B21e);

uint24[4] memory fees = [uint24(100), 500, 3000, 10000];
uint256 bestOut;
uint24 bestFee;

for (uint256 i = 0; i < fees.length; i++) {
    try quoter.quoteExactInputSingle(
        IQuoterV2.QuoteExactInputSingleParams({
            tokenIn: WETH,
            tokenOut: USDC,
            amountIn: 1 ether,
            fee: fees[i],
            sqrtPriceLimitX96: 0
        })
    ) returns (uint256 amountOut, uint160, uint32, uint256) {
        if (amountOut > bestOut) {
            bestOut = amountOut;
            bestFee = fees[i];
        }
    } catch {}
}
```

### Multi-Hop Routing

Direct swaps are not always optimal. Common intermediate hops:

```
ETH → WBTC         may route as  ETH → USDC → WBTC
LINK → UNI         may route as  LINK → ETH → UNI
Low-cap → Low-cap  almost always routes through ETH or USDC
```

```solidity
// Multi-hop quote: tokenA -> WETH -> tokenB
bytes memory path = abi.encodePacked(
    tokenA, uint24(3000), WETH, uint24(500), tokenB
);

(uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate) =
    quoter.quoteExactInput(path, amountIn);
```

### Price Impact Estimation

```solidity
// sqrtPriceX96After from the quote tells you where price lands
// Compare to current sqrtPriceX96 to estimate impact
(uint160 sqrtPriceCurrent,,,,,,) = pool.slot0();
uint256 priceBefore = uint256(sqrtPriceCurrent) * uint256(sqrtPriceCurrent) / (1 << 192);
uint256 priceAfter  = uint256(sqrtPriceAfter) * uint256(sqrtPriceAfter) / (1 << 192);
uint256 impactBps   = (priceBefore - priceAfter) * 10_000 / priceBefore;
```

## Pool Health Indicators

| Metric | What It Means | Warning Sign |
|--------|--------------|--------------|
| TVL trend | Total value committed by LPs | Declining over 7+ days = liquidity flight |
| Volume / TVL ratio | Fee generation efficiency | < 0.01 daily = stagnant pool |
| Active liquidity concentration | How tightly LPs bracket current price | Wide spread = high slippage for traders |
| Active position count | Number of LPs with in-range liquidity | < 5 positions = fragile liquidity |
| Fee revenue vs IL | LP profitability | Negative = LPs losing money, expect exits |
| Oracle cardinality | V3 observation buffer size (slot0 field 4) | Default 1 = no TWAP history |
| Tick crossing frequency | How often price moves through tick boundaries | Very high = volatile, may deter LPs |

### Reading Oracle Cardinality

```bash
# observationCardinalityNext is the 5th return value of slot0
cast call <pool_address> "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)"

# Increase cardinality for better TWAP support (anyone can call, pays gas)
cast send <pool_address> "increaseObservationCardinalityNext(uint16)" 100
```

## Pool Creation

### V3 Pool Creation

```solidity
IUniswapV3Factory factory = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

address pool = factory.createPool(tokenA, tokenB, fee);

// Initialize with starting price (sqrtPriceX96 format)
// For 1 token0 = 2000 token1 (e.g., 1 ETH = 2000 USDC with 18/6 decimals):
// sqrtPriceX96 = sqrt(2000 * 1e6 / 1e18) * 2^96
uint160 sqrtPriceX96 = 3543191142285914205922034323215; // example
IUniswapV3Pool(pool).initialize(sqrtPriceX96);
```

### V4 Pool Initialization

```solidity
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

IPoolManager poolManager = IPoolManager(0x000000000004444c5dc75cb358380d2e3de08a90);

PoolKey memory key = PoolKey({
    currency0: Currency.wrap(token0),
    currency1: Currency.wrap(token1),
    fee: 3000,
    tickSpacing: 60,
    hooks: IHooks(address(0))
});

poolManager.initialize(key, sqrtPriceX96);
```

### sqrtPriceX96 Calculator

```solidity
/// @notice Computes sqrtPriceX96 from a human-readable price ratio
/// @param price The price of token0 in terms of token1 (e.g., 2000 for 1 ETH = 2000 USDC)
/// @param decimals0 Decimals of token0
/// @param decimals1 Decimals of token1
function computeSqrtPriceX96(
    uint256 price,
    uint8 decimals0,
    uint8 decimals1
) pure returns (uint160) {
    // adjustedPrice = price * 10^decimals0 / 10^decimals1
    // sqrtPriceX96 = sqrt(adjustedPrice) * 2^96
    uint256 adjustedPrice = price * (10 ** decimals1) / (10 ** decimals0);
    uint256 sqrtPrice = Math.sqrt(adjustedPrice);
    return uint160(sqrtPrice << 96);
}
```

## Forge Scripts for Pool Analysis

### Query All Fee Tiers for a Token Pair

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract PoolScanner is Script {
    IUniswapV3Factory constant FACTORY = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

    function run(address tokenA, address tokenB) external view {
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];
        string[4] memory labels = ["0.01%", "0.05%", "0.30%", "1.00%"];

        for (uint256 i = 0; i < fees.length; i++) {
            address pool = FACTORY.getPool(tokenA, tokenB, fees[i]);
            if (pool != address(0)) {
                (uint160 sqrtPriceX96, int24 tick,,,,,) = IUniswapV3Pool(pool).slot0();
                uint128 liquidity = IUniswapV3Pool(pool).liquidity();
                console2.log("--- Fee Tier:", labels[i], "---");
                console2.log("  Pool:", pool);
                console2.log("  Tick:", tick);
                console2.log("  Liquidity:", liquidity);
            }
        }
    }
}
```

Run with: `forge script script/PoolScanner.s.sol --sig "run(address,address)" <tokenA> <tokenB> --fork-url $ETH_RPC_URL`

### Read Tick-Level Liquidity Distribution

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract TickInspector is Script {
    function run(address pool, int24 tickLower, int24 tickUpper) external view {
        IUniswapV3Pool p = IUniswapV3Pool(pool);
        int24 spacing = p.tickSpacing();
        (,int24 currentTick,,,,,) = p.slot0();

        console2.log("Current tick:", currentTick);
        console2.log("Tick spacing:", spacing);

        int24 tick = tickLower - (tickLower % spacing);
        while (tick <= tickUpper) {
            (uint128 liquidityGross, int128 liquidityNet,,,,,,) = p.ticks(tick);
            if (liquidityGross > 0) {
                console2.log("Tick:", tick);
                console2.log("  liquidityGross:", liquidityGross);
                console2.log("  liquidityNet:", liquidityNet);
            }
            tick += spacing;
        }
    }
}
```

Run with: `forge script script/TickInspector.s.sol --sig "run(address,int24,int24)" <pool> <lower> <upper> --fork-url $ETH_RPC_URL`

### Compare V3 Pool Depth Across Fee Tiers

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IQuoterV2} from "@uniswap/v3-periphery/contracts/interfaces/IQuoterV2.sol";

contract DepthComparator is Script {
    IUniswapV3Factory constant FACTORY = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);
    IQuoterV2 constant QUOTER = IQuoterV2(0x61fFE014bA17989E743c5F6cB21bF9697530B21e);

    function run(address tokenIn, address tokenOut, uint256 amountIn) external {
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];

        for (uint256 i = 0; i < fees.length; i++) {
            address pool = FACTORY.getPool(tokenIn, tokenOut, fees[i]);
            if (pool == address(0)) continue;

            try QUOTER.quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: amountIn,
                    fee: fees[i],
                    sqrtPriceLimitX96: 0
                })
            ) returns (uint256 amountOut, uint160, uint32 ticksCrossed, uint256 gasEst) {
                console2.log("Fee:", fees[i]);
                console2.log("  amountOut:", amountOut);
                console2.log("  ticksCrossed:", ticksCrossed);
                console2.log("  gasEstimate:", gasEst);
            } catch {}
        }
    }
}
```

Run with: `forge script script/DepthComparator.s.sol --sig "run(address,address,uint256)" <tokenIn> <tokenOut> <amount> --fork-url $ETH_RPC_URL`

### Fee Tier Arbitrage Detector

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";

contract ArbDetector is Script {
    IUniswapV3Factory constant FACTORY = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

    function run(address tokenA, address tokenB) external view {
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];
        int24[] memory ticks = new int24[](4);
        uint160[] memory prices = new uint160[](4);
        uint256 count;

        for (uint256 i = 0; i < fees.length; i++) {
            address pool = FACTORY.getPool(tokenA, tokenB, fees[i]);
            if (pool == address(0)) continue;
            (uint160 sqrtPriceX96, int24 tick,,,,,) = IUniswapV3Pool(pool).slot0();
            ticks[count] = tick;
            prices[count] = sqrtPriceX96;
            count++;
            console2.log("Fee:", fees[i], "Tick:", tick);
        }

        if (count >= 2) {
            int24 maxDiff;
            for (uint256 i = 0; i < count; i++) {
                for (uint256 j = i + 1; j < count; j++) {
                    int24 diff = ticks[i] > ticks[j] ? ticks[i] - ticks[j] : ticks[j] - ticks[i];
                    if (diff > maxDiff) maxDiff = diff;
                }
            }
            console2.log("Max tick divergence:", maxDiff);
            if (maxDiff > 10) {
                console2.log(">> Potential cross-fee-tier arbitrage opportunity");
            }
        }
    }
}
```

## Common Token Addresses (Ethereum Mainnet)

```
WETH:  0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC:  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
USDT:  0xdAC17F958D2ee523a2206206994597C13D831ec7
DAI:   0x6B175474E89094C44Da98b954EedeAC495271d0F
WBTC:  0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599
UNI:   0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
LINK:  0x514910771AF9Ca656af840dff83E8264EcF986CA
wstETH:0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
```

## Checklist

- [ ] Queried all four V3 fee tiers before picking a pool
- [ ] Verified pool address is nonzero before reading state
- [ ] Confirmed `token0`/`token1` ordering matches expectations
- [ ] Checked `liquidity` is nonzero (pool has active LPs in range)
- [ ] Used QuoterV2 for offchain price quotes, not `slot0` price directly
- [ ] Compared multi-hop routes against direct swaps for better output
- [ ] Assessed TVL trend and volume/TVL ratio for pool health
- [ ] Verified oracle cardinality if relying on TWAP
- [ ] For V4: computed `PoolId` correctly from `PoolKey` with proper currency ordering
- [ ] For V4: confirmed hook address permissions match pool configuration
- [ ] Never hardcoded pool addresses without verifying via `cast code`
- [ ] Used fork testing (`--fork-url`) for all onchain queries in scripts
