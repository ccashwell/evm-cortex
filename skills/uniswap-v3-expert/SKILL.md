---
name: uniswap-v3-expert
description: Use when building on, integrating with, or analyzing Uniswap V3. Covers concentrated liquidity, tick-based pricing, UniswapV3Factory, UniswapV3Pool, NonfungiblePositionManager, SwapRouter, oracle observations, fee tiers, and production deployment addresses across all chains.
---

# Uniswap V3 Expert

## Architecture Overview

Uniswap V3 is a concentrated liquidity AMM where each (tokenA, tokenB, fee) triple gets its own `UniswapV3Pool` contract, deployed via `CREATE2` from a singleton `UniswapV3Factory`. LPs provide liquidity in discrete price ranges instead of across the full (0, infinity) curve, dramatically improving capital efficiency.

### Contract Hierarchy

```
UniswapV3Factory (singleton)
├── creates UniswapV3Pool contracts via CREATE2 (one per token pair + fee tier)
│   ├── Core swap, mint, burn, collect, flash, observe logic
│   └── Stores tick state, positions, observations, and protocol fees
│
Periphery contracts (stateless routers / managers):
├── NonfungiblePositionManager — wraps LP positions as ERC-721 NFTs
├── SwapRouter — single and multi-hop exact-input / exact-output swaps
├── SwapRouter02 — v2+v3 unified router with multicall
├── UniversalRouter — command-based router supporting v2, v3, permits, NFTs
├── Quoter — off-chain swap simulation (reverts internally to return amounts)
├── QuoterV2 — returns sqrtPriceX96After, initializedTicksCrossed, gasEstimate
└── TickLens — batch read initialized ticks for a pool
```

### Token Ordering

Uniswap V3 enforces `token0 < token1` (by address). The factory and pool reject misordered pairs. Always sort before calling factory or pool functions:

```solidity
(address token0, address token1) = tokenA < tokenB
    ? (tokenA, tokenB)
    : (tokenB, tokenA);
```

### Pool Address Derivation (CREATE2)

Pool addresses are deterministic. You can compute them offchain without querying the factory:

```solidity
address pool = address(uint160(uint256(keccak256(abi.encodePacked(
    hex"ff",
    factory,
    keccak256(abi.encode(token0, token1, fee)),
    POOL_INIT_CODE_HASH
)))));
```

The `POOL_INIT_CODE_HASH` for Uniswap V3 is:
`0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54`

## Concentrated Liquidity Model

### Ticks and Price

Price is discretized into **ticks**. The price at tick `i` is:

```
P(i) = 1.0001^i
```

This gives ~1 basis point precision per tick. Ticks range from `MIN_TICK = -887272` to `MAX_TICK = 887272`.

### sqrtPriceX96

Uniswap V3 stores the square root of price as a Q64.96 fixed-point number:

```
sqrtPriceX96 = sqrt(token1 / token0) * 2^96
```

Converting between tick and sqrtPriceX96:

```solidity
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";

uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
```

Boundary values:
- `TickMath.MIN_SQRT_RATIO = 4295128739` (tick -887272)
- `TickMath.MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342` (tick 887272)

### Fee Tiers and Tick Spacing

| Fee (bps) | Fee (uint24) | Tick Spacing | Use Case |
|-----------|-------------|-------------|----------|
| 0.01% | 100 | 1 | Stable pairs (USDC/USDT, DAI/USDC) |
| 0.05% | 500 | 10 | Stable pairs, correlated assets |
| 0.30% | 3000 | 60 | Standard pairs (ETH/USDC, WBTC/ETH) |
| 1.00% | 10000 | 200 | Exotic pairs, high volatility |

Tick spacing means LPs can only place range boundaries at ticks divisible by the spacing. The 1 bps tier was added via governance (not in original deployment).

### Liquidity Math

Within a single tick range, the V3 pool behaves like a constant-product AMM scaled by liquidity `L`:

```
x * y = L^2   (virtual reserves within the active range)
```

Real reserves required for a position between sqrtPriceA and sqrtPriceB with liquidity L:

```
amount0 = L * (1/sqrtPriceA - 1/sqrtPriceB)    (when price < lower bound: all token0)
amount1 = L * (sqrtPriceB - sqrtPriceA)          (when price > upper bound: all token1)
```

When price is within the range, the position holds a mix of both tokens.

## Core Contract Functions

### UniswapV3Factory

```solidity
interface IUniswapV3Factory {
    /// @notice Creates a pool for the given two tokens and fee
    /// @param tokenA One of the two tokens in the desired pool
    /// @param tokenB The other of the two tokens in the desired pool
    /// @param fee The desired fee for the pool (100, 500, 3000, or 10000)
    /// @return pool The address of the newly created pool
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool);

    /// @notice Returns the pool address for a given pair of tokens and fee, or address(0)
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);

    /// @notice Returns the tick spacing for a given fee amount
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);

    /// @notice Returns the current protocol fee controller
    function owner() external view returns (address);

    /// @notice Enables a fee amount with the given tick spacing (governance only)
    function enableFeeAmount(uint24 fee, int24 tickSpacing) external;
}
```

### UniswapV3Pool

```solidity
interface IUniswapV3Pool {
    /// @notice Sets the initial price for the pool. Can only be called once.
    /// @param sqrtPriceX96 The initial sqrt price as a Q64.96 value
    function initialize(uint160 sqrtPriceX96) external;

    /// @notice Adds liquidity for the given recipient/tickLower/tickUpper position
    /// @dev The caller of this method receives a callback (uniswapV3MintCallback)
    ///      in which they must pay any token0 or token1 owed for the liquidity
    /// @param recipient The address for which the liquidity will be created
    /// @param tickLower The lower tick of the position
    /// @param tickUpper The upper tick of the position
    /// @param amount The amount of liquidity to mint
    /// @param data Any data to be passed through to the callback
    /// @return amount0 The amount of token0 that was paid to mint
    /// @return amount1 The amount of token1 that was paid to mint
    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        bytes calldata data
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Burns liquidity from the sender and accounts tokens owed
    /// @dev Does NOT transfer tokens — must call collect() afterward
    /// @param tickLower The lower tick of the position
    /// @param tickUpper The upper tick of the position
    /// @param amount The amount of liquidity to burn
    /// @return amount0 The amount of token0 owed to the position
    /// @return amount1 The amount of token1 owed to the position
    function burn(
        int24 tickLower,
        int24 tickUpper,
        uint128 amount
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Collects tokens owed to a position
    /// @dev Must burn(0) first to update fee accounting if only collecting fees
    /// @param recipient The address which should receive the collected tokens
    /// @param tickLower The lower tick of the position
    /// @param tickUpper The upper tick of the position
    /// @param amount0Requested How much token0 should be withdrawn
    /// @param amount1Requested How much token1 should be withdrawn
    /// @return amount0 The amount of token0 collected
    /// @return amount1 The amount of token1 collected
    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1);

    /// @notice Swap token0 for token1, or token1 for token0
    /// @param recipient The address to receive the output of the swap
    /// @param zeroForOne Direction: true = token0 → token1, false = token1 → token0
    /// @param amountSpecified Positive = exact input, negative = exact output
    /// @param sqrtPriceLimitX96 Price limit — swap stops if crossed
    ///        For zeroForOne: must be < current price and > MIN_SQRT_RATIO
    ///        For oneForZero: must be > current price and < MAX_SQRT_RATIO
    /// @param data Callback data passed to uniswapV3SwapCallback
    /// @return amount0 Delta of token0 balance of the pool (positive = pool received)
    /// @return amount1 Delta of token1 balance of the pool
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    /// @notice Flash loans both tokens
    /// @param recipient The address which will receive the token0 and token1 amounts
    /// @param amount0 The amount of token0 to flash
    /// @param amount1 The amount of token1 to flash
    /// @param data Callback data passed to uniswapV3FlashCallback
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;

    /// @notice Returns cumulative tick and liquidity values at given seconds ago
    /// @param secondsAgos Array of seconds ago from current block timestamp
    /// @return tickCumulatives Cumulative tick values at each secondsAgo
    /// @return secondsPerLiquidityCumulativeX128s Cumulative seconds per liquidity
    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (
        int56[] memory tickCumulatives,
        uint160[] memory secondsPerLiquidityCumulativeX128s
    );

    /// @notice Grows the observation buffer to support longer TWAPs
    /// @param observationCardinalityNext Minimum number of observations to store
    function increaseObservationCardinalityNext(
        uint16 observationCardinalityNext
    ) external;

    // --- State view functions ---
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );

    function liquidity() external view returns (uint128);
    function fee() external view returns (uint24);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickSpacing() external view returns (int24);
    function maxLiquidityPerTick() external view returns (uint128);

    function ticks(int24 tick) external view returns (
        uint128 liquidityGross,
        int128 liquidityNet,
        uint256 feeGrowthOutside0X128,
        uint256 feeGrowthOutside1X128,
        int56 tickCumulativeOutside,
        uint160 secondsPerLiquidityOutsideX128,
        uint32 secondsOutside,
        bool initialized
    );

    function positions(bytes32 key) external view returns (
        uint128 _liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    );
}
```

Position keys for the core pool contract use `keccak256(abi.encodePacked(owner, tickLower, tickUpper))`.

## NonfungiblePositionManager

The `NonfungiblePositionManager` (NPM) wraps core pool positions as ERC-721 NFTs. Most LPs interact with V3 through the NPM rather than calling the pool directly.

```solidity
interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    /// @notice Creates a new position wrapped in an NFT
    /// @return tokenId The ID of the minted NFT
    /// @return liquidity The amount of liquidity for this position
    /// @return amount0 The amount of token0 deposited
    /// @return amount1 The amount of token1 deposited
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    /// @notice Collects fees and principal owed to a position
    function collect(CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    /// @notice Burns a token ID. Position must have 0 liquidity and 0 tokens owed.
    function burn(uint256 tokenId) external payable;

    /// @notice Returns the position data for a given token ID
    function positions(uint256 tokenId) external view returns (
        uint96 nonce,
        address operator,
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
    );
}
```

### Collecting Fees

To collect accrued trading fees without removing liquidity, call `decreaseLiquidity` with `liquidity = 0` (or simply use `collect` after calling `burn(0)` on the core pool). Through the NPM:

```solidity
// Trigger fee accounting update via zero-amount decrease
positionManager.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams({
    tokenId: tokenId,
    liquidity: 0,
    amount0Min: 0,
    amount1Min: 0,
    deadline: block.timestamp
}));

// Collect all owed tokens (fees + any burned principal)
positionManager.collect(INonfungiblePositionManager.CollectParams({
    tokenId: tokenId,
    recipient: msg.sender,
    amount0Max: type(uint128).max,
    amount1Max: type(uint128).max
}));
```

### Full Position Lifecycle

```solidity
// 1. Approve tokens to NPM
IERC20(token0).approve(address(positionManager), amount0);
IERC20(token1).approve(address(positionManager), amount1);

// 2. Mint position
(uint256 tokenId, uint128 liquidity, uint256 used0, uint256 used1) =
    positionManager.mint(INonfungiblePositionManager.MintParams({
        token0: token0,
        token1: token1,
        fee: 3000,
        tickLower: -60,
        tickUpper: 60,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0,
        amount1Min: 0,
        recipient: msg.sender,
        deadline: block.timestamp
    }));

// 3. Collect fees (anytime)
positionManager.collect(INonfungiblePositionManager.CollectParams({
    tokenId: tokenId,
    recipient: msg.sender,
    amount0Max: type(uint128).max,
    amount1Max: type(uint128).max
}));

// 4. Remove liquidity
positionManager.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams({
    tokenId: tokenId,
    liquidity: liquidity,
    amount0Min: 0,
    amount1Min: 0,
    deadline: block.timestamp
}));

// 5. Collect principal + remaining fees
positionManager.collect(INonfungiblePositionManager.CollectParams({
    tokenId: tokenId,
    recipient: msg.sender,
    amount0Max: type(uint128).max,
    amount1Max: type(uint128).max
}));

// 6. Burn NFT (optional, position must have 0 liquidity and 0 owed)
positionManager.burn(tokenId);
```

## SwapRouter Integration

### SwapRouter (original)

```solidity
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;  // 0 for no limit
    }

    /// @notice Swaps amountIn of one token for as much as possible of another token
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);

    struct ExactInputParams {
        bytes path;          // abi.encodePacked(tokenIn, fee, ..., tokenOut)
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Swaps along the specified multi-hop path
    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut);

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps as little as possible of one token for amountOut of another
    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        returns (uint256 amountIn);

    struct ExactOutputParams {
        bytes path;          // abi.encodePacked(tokenOut, fee, ..., tokenIn) — REVERSED
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    /// @notice Swaps along a reversed path to get exact output amount
    function exactOutput(ExactOutputParams calldata params)
        external
        payable
        returns (uint256 amountIn);
}
```

### Multi-Hop Path Encoding

Paths are tightly packed sequences of `(token, fee, token, fee, ..., token)`:

```solidity
// Single hop: WETH → 0.3% → USDC
bytes memory path = abi.encodePacked(WETH, uint24(3000), USDC);

// Multi-hop: WETH → 0.3% → USDC → 0.01% → DAI
bytes memory path = abi.encodePacked(WETH, uint24(3000), USDC, uint24(100), DAI);
```

For `exactOutput`, the path is **reversed** (starts with output token):

```solidity
// Exact output multi-hop: want DAI, pay WETH
// Path is: DAI → 0.01% → USDC → 0.3% → WETH (reversed order)
bytes memory path = abi.encodePacked(DAI, uint24(100), USDC, uint24(3000), WETH);
```

### SwapRouter02 (Unified V2+V3 Router)

`SwapRouter02` at `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` on Ethereum mainnet unifies Uniswap V2 and V3 swaps under one interface with multicall support. The `deadline` parameter is removed from individual swap structs — use the `checkDeadline` multicall wrapper instead.

### Using the Quoter for Off-Chain Price Estimates

The Quoter simulates a swap and reverts internally to return the result. Never call it onchain (wastes gas with guaranteed revert).

```solidity
interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        );
}
```

Use `QuoterV2` over the original `Quoter` — it returns additional data (`sqrtPriceX96After`, `initializedTicksCrossed`, `gasEstimate`) useful for routing.

## Oracle System

### Built-In TWAP

Every V3 pool stores an array of `(blockTimestamp, tickCumulative, secondsPerLiquidityCumulative)` observations. The pool writes one observation per block in which a swap occurs.

### Reading the Oracle

```solidity
// Get the 30-minute TWAP tick
uint32[] memory secondsAgos = new uint32[](2);
secondsAgos[0] = 1800; // 30 minutes ago
secondsAgos[1] = 0;    // now

(int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);

int24 twapTick = int24((tickCumulatives[1] - tickCumulatives[0]) / 1800);

// Convert tick to price
uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(twapTick);
```

### Observation Cardinality

- Default cardinality = 1 — only the latest observation is stored
- Must call `increaseObservationCardinalityNext()` to enable longer TWAPs
- Each observation costs ~20k gas to write (one per block on first swap)
- To support a 1-hour TWAP at 12s blocks, need at least 300 observations

```solidity
// Expand observation buffer to support 1-hour TWAP
pool.increaseObservationCardinalityNext(350); // some buffer
```

### Oracle Security Considerations

- Geometric mean TWAP is manipulation-resistant over multiple blocks
- Single-block manipulation is limited by pool liquidity and block timing
- Use longer TWAP windows (>= 30 minutes) for critical price feeds
- V3 TWAPs are geometric (tick-based), not arithmetic — immune to flash loan manipulation within a single block
- Always verify observation cardinality is sufficient before relying on TWAP
- Combine TWAP with Chainlink for defense in depth

## Callback Pattern

V3 uses a pull-based token collection model. The pool calls back into the caller to collect tokens owed.

### Swap Callback

```solidity
/// @notice Called by the pool after executing a swap
/// @dev Must pay the pool the tokens owed for the swap.
///      Positive delta = tokens owed TO the pool.
function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes calldata data
) external {
    // CRITICAL: Verify the caller is the expected pool
    require(msg.sender == address(pool), "unauthorized callback");

    // Decode any data passed through the swap
    address payer = abi.decode(data, (address));

    // Pay whichever token is owed (positive delta = owed to pool)
    if (amount0Delta > 0) {
        IERC20(pool.token0()).safeTransferFrom(payer, msg.sender, uint256(amount0Delta));
    }
    if (amount1Delta > 0) {
        IERC20(pool.token1()).safeTransferFrom(payer, msg.sender, uint256(amount1Delta));
    }
}
```

### Mint Callback

```solidity
/// @notice Called by the pool when minting liquidity
/// @dev Must pay the pool both token0 and token1 owed
function uniswapV3MintCallback(
    uint256 amount0Owed,
    uint256 amount1Owed,
    bytes calldata data
) external {
    require(msg.sender == address(pool), "unauthorized callback");
    address payer = abi.decode(data, (address));

    if (amount0Owed > 0) {
        IERC20(pool.token0()).safeTransferFrom(payer, msg.sender, amount0Owed);
    }
    if (amount1Owed > 0) {
        IERC20(pool.token1()).safeTransferFrom(payer, msg.sender, amount1Owed);
    }
}
```

### Flash Callback

```solidity
/// @notice Called by the pool after a flash loan
/// @dev Must repay the flash-loaned amount plus fees
function uniswapV3FlashCallback(
    uint256 fee0,
    uint256 fee1,
    bytes calldata data
) external {
    require(msg.sender == address(pool), "unauthorized callback");

    // Perform arbitrage or other operations here

    // Repay principal + fee
    if (fee0 > 0 || amount0 > 0) {
        IERC20(pool.token0()).safeTransfer(msg.sender, amount0 + fee0);
    }
    if (fee1 > 0 || amount1 > 0) {
        IERC20(pool.token1()).safeTransfer(msg.sender, amount1 + fee1);
    }
}
```

**Callback security**: Always verify `msg.sender` is the expected pool. Compute the expected pool address via CREATE2 rather than storing it, or validate against the factory:

```solidity
function _verifyCallback(address tokenA, address tokenB, uint24 fee) internal view {
    address expected = IUniswapV3Factory(factory).getPool(tokenA, tokenB, fee);
    require(msg.sender == expected, "unauthorized callback");
}
```

## Production Deployment Addresses

### Ethereum Mainnet

| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| NonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` |
| SwapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` |
| Quoter | `0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6` |
| QuoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |
| UniversalRouter (current) | `0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af` |
| TickLens | `0xbfd8137f7d1516D3fe7e20F7doA5099eEc6856aF` |

### Cross-Chain Deployments

V3 core contracts (Factory, NPM, SwapRouter, Quoter) are deployed to the same addresses across all supported chains via CREATE2:

| Chain | Factory | NPM | SwapRouter |
|-------|---------|-----|------------|
| Arbitrum | `0x1F98431c...F984` | `0xC36442b4...FE88` | `0xE592427A...1564` |
| Optimism | `0x1F98431c...F984` | `0xC36442b4...FE88` | `0xE592427A...1564` |
| Polygon | `0x1F98431c...F984` | `0xC36442b4...FE88` | `0xE592427A...1564` |
| Base | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` | varies |
| BNB Chain | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` | `0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613` | varies |
| Avalanche | `0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD` | varies | varies |
| Celo | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` | varies | varies |

**CRITICAL**: Addresses on Base, BNB, Avalanche, Celo, and newer chains differ from the canonical set. Always verify with `cast code <address> --rpc-url <chain>` or check the Uniswap Labs deployment repository before integrating.

## Foundry Setup

### Install Dependencies

```bash
forge install Uniswap/v3-core --no-commit
forge install Uniswap/v3-periphery --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
```

### Remappings (foundry.toml or remappings.txt)

```
@uniswap/v3-core/=lib/v3-core/
@uniswap/v3-periphery/=lib/v3-periphery/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

### Fork Testing Against Mainnet Pools

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract UniswapV3ForkTest is Test {
    ISwapRouter constant ROUTER = ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    function setUp() public {
        vm.createSelectFork("mainnet");
    }

    function test_exactInputSingle() public {
        uint256 amountIn = 1 ether;
        deal(WETH, address(this), amountIn);
        IERC20(WETH).approve(address(ROUTER), amountIn);

        uint256 amountOut = ROUTER.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: USDC,
                fee: 3000,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        assertGt(amountOut, 0, "swap returned zero");
        assertGt(IERC20(USDC).balanceOf(address(this)), 0, "no USDC received");
    }
}
```

Run with:

```bash
forge test --fork-url $ETH_RPC_URL --match-contract UniswapV3ForkTest -vvv
```

## Common V3 Patterns

### Direct Pool Swap (No Router)

For maximum gas efficiency or custom routing, call the pool directly:

```solidity
// Swap 1 WETH for USDC via the WETH/USDC 0.3% pool
IUniswapV3Pool pool = IUniswapV3Pool(factory.getPool(WETH, USDC, 3000));

// zeroForOne = true means token0 → token1
// amountSpecified > 0 means exact input
(int256 amount0, int256 amount1) = pool.swap(
    recipient,
    true,                              // zeroForOne
    int256(1 ether),                   // exact input
    TickMath.MIN_SQRT_RATIO + 1,       // price limit (min for zeroForOne)
    abi.encode(msg.sender)             // callback data
);
```

### Price Limit Constants

```solidity
// For zeroForOne swaps (token0 → token1), price decreases
uint160 sqrtPriceLimitX96 = TickMath.MIN_SQRT_RATIO + 1;

// For oneForZero swaps (token1 → token0), price increases
uint160 sqrtPriceLimitX96 = TickMath.MAX_SQRT_RATIO - 1;
```

### Computing Position Fees Offchain

```solidity
// Read position from NPM
(, , , , , int24 tickLower, int24 tickUpper, uint128 liquidity,
 uint256 feeGrowthInside0Last, uint256 feeGrowthInside1Last,
 uint128 tokensOwed0, uint128 tokensOwed1) = npm.positions(tokenId);

// Read current fee growth from pool
(uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1) =
    (pool.feeGrowthGlobal0X128(), pool.feeGrowthGlobal1X128());

// Calculate uncollected fees (simplified — needs tick fee growth subtraction)
uint256 fees0 = tokensOwed0 + (feeGrowthInside0Current - feeGrowthInside0Last) * liquidity / (1 << 128);
uint256 fees1 = tokensOwed1 + (feeGrowthInside1Current - feeGrowthInside1Last) * liquidity / (1 << 128);
```

### Just-In-Time (JIT) Liquidity Pattern

JIT liquidity is a MEV strategy where a searcher mints a tight range position just before a large swap, earns concentrated fees, then removes the position in the same or next block:

```
Block N:
1. Observe pending large swap in mempool
2. Mint concentrated position around current tick
3. Large swap executes — LP earns concentrated fees
4. Remove liquidity and collect fees
```

This is profitable because concentrated liquidity in a tiny range captures nearly all fees from the swap. However, it requires mempool access and priority gas auctions.

## V3 vs V4 Migration Notes

| Aspect | Uniswap V3 | Uniswap V4 |
|--------|-----------|-----------|
| Pool architecture | One contract per pool | Singleton `PoolManager` |
| Pool creation | `factory.createPool()` | `poolManager.initialize()` |
| Token transfers | Callbacks (pull pattern) | Flash accounting with `settle()` / `take()` |
| LP positions | `NonfungiblePositionManager` (ERC-721) | `PositionManager` (ERC-6909) |
| Swap routing | `SwapRouter` / `SwapRouter02` | `UniversalRouter` or custom routers |
| Extensibility | None | Hooks at every lifecycle point |
| Fee model | Fixed fee tiers | Dynamic fees via hooks |
| Flash loans | `pool.flash()` | Free via flash accounting (take + settle within unlock) |
| Pool ID | Contract address | `keccak256(abi.encode(PoolKey))` |
| Gas (single swap) | ~130k-180k | ~100k-140k (singleton savings) |
| Oracle | Built-in observation array | Removed from core — implement via hooks |

### Key Migration Considerations

1. **Oracle removal**: V4 removed built-in oracles. If you depend on V3 TWAPs, either keep using V3 pools or implement an oracle hook in V4.
2. **ERC-721 → ERC-6909**: V4 positions use semi-fungible ERC-6909 tokens instead of NFTs. This changes how positions are tracked and transferred.
3. **Callback → flash accounting**: V3 callbacks that push tokens to the pool are replaced by V4's `settle()` and `take()` within an `unlock()` context.
4. **Fee tiers → dynamic**: V3 fixed fee tiers become fully configurable via hooks in V4. Custom fee logic (volatility-based, time-based) is possible.

## Security Considerations

### Slippage Protection

Always set meaningful `amountOutMinimum` (exact input) or `amountInMaximum` (exact output). Using 0 invites sandwich attacks.

```solidity
// Calculate minimum output with 0.5% slippage tolerance
uint256 amountOutMin = (expectedAmountOut * 995) / 1000;
```

### Deadline Protection

Always use a reasonable `deadline` parameter. Setting `block.timestamp` is useless onchain (always passes). Use `block.timestamp + 300` (5 minutes) or pass a user-specified deadline.

### Callback Verification

Unverified callbacks are the most common V3 integration vulnerability. Always verify:

```solidity
// Option A: Check against factory
require(msg.sender == IUniswapV3Factory(FACTORY).getPool(token0, token1, fee));

// Option B: Recompute CREATE2 address (saves an external call)
address expected = address(uint160(uint256(keccak256(abi.encodePacked(
    hex"ff",
    FACTORY,
    keccak256(abi.encode(token0, token1, fee)),
    POOL_INIT_CODE_HASH
)))));
require(msg.sender == expected);
```

### Price Manipulation Resistance

- Never use `slot0().sqrtPriceX96` as a price oracle — it reflects the instantaneous spot price and is trivially manipulable within a transaction
- Use `observe()` for TWAP over multiple blocks
- For critical operations, combine V3 TWAP with Chainlink as a secondary oracle
- Flash loans cannot manipulate the geometric mean TWAP within a single block

### Reentrancy

V3 pools have a `slot0.unlocked` mutex that prevents reentrancy into the pool during swaps and mints. However, your own contracts receiving callbacks should still use `nonReentrant` guards for defense in depth.

## Integration Checklist

### Swaps
- [ ] Using `SafeERC20` for all token transfers
- [ ] `amountOutMinimum` / `amountInMaximum` set to meaningful values (never 0 in production)
- [ ] Deadline is user-supplied or uses a reasonable future timestamp (not `block.timestamp`)
- [ ] sqrtPriceLimitX96 set correctly for swap direction or 0 for no limit
- [ ] Callback verifies `msg.sender` is the expected pool via CREATE2 or factory lookup
- [ ] Multi-hop path encoding is correct (packed `token, fee, token, ...`)
- [ ] For `exactOutput`, path is reversed (output token first)
- [ ] Unused input tokens are refunded to the user on exact output swaps

### Liquidity Provision
- [ ] Token pair is correctly ordered (`token0 < token1`)
- [ ] Tick bounds are multiples of the pool's `tickSpacing`
- [ ] `amount0Min` / `amount1Min` protect against sandwich attacks during mint
- [ ] Fee collection calls `decreaseLiquidity(0)` or equivalent to update accounting
- [ ] Position is fully withdrawn (decreaseLiquidity + collect) before calling `burn`
- [ ] Handling the case where a position goes fully out of range (100% one token)

### Oracle Usage
- [ ] Observation cardinality increased before relying on TWAP
- [ ] TWAP window is >= 30 minutes for security-critical price feeds
- [ ] Never using `slot0().sqrtPriceX96` as a price oracle
- [ ] Handling `OLD` observation errors (requested time exceeds oldest observation)
- [ ] TWAP combined with secondary oracle for critical operations

### Flash Loans
- [ ] Flash callback verifies `msg.sender` is the pool
- [ ] Repayment amount includes the pool fee (`amount + fee`)
- [ ] Flash loan is profitable after fees, gas, and all swap costs
- [ ] Access control prevents unauthorized triggering

### General
- [ ] All addresses verified on the target chain (not assumed from mainnet)
- [ ] POOL_INIT_CODE_HASH matches the V3 factory on the target chain
- [ ] Token decimal differences handled correctly (USDC = 6, WBTC = 8, most = 18)
- [ ] Fee-on-transfer tokens use balance-before/after pattern if supported
- [ ] Tested on a mainnet fork with `forge test --fork-url`
- [ ] Gas profiled with `forge test --gas-report`
