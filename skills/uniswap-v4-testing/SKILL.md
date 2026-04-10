---
name: uniswap-v4-testing
description: Use when writing Foundry tests for Uniswap V4 hooks, router integrations, or pool interactions. Covers test setup with Deployers, HookMiner for address mining, swap/liquidity test patterns, gas profiling, fork testing against production pools, and invariant testing for custom hooks.
---

# Uniswap V4 Testing with Foundry

## Test Setup with Deployers

The `Deployers` base contract from v4-core bootstraps a complete V4 environment — PoolManager, test routers, currencies, and standard constants.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

import {MyHook} from "../src/MyHook.sol";

contract MyHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    MyHook hook;
    PoolKey key;
    PoolId poolId;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        // Deploy hook to mined address (see HookMiner section)
        _deployHook();

        key = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        manager.initialize(key, SQRT_PRICE_1_1);
        poolId = key.toId();

        modifyLiquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120,
                tickUpper: 120,
                liquidityDelta: 10 ether,
                salt: bytes32(0)
            }),
            ZERO_BYTES
        );
    }
}
```

### What `Deployers` Provides

| Member | Type | Description |
|--------|------|-------------|
| `manager` | `IPoolManager` | Singleton PoolManager instance |
| `swapRouter` | `PoolSwapTest` | Test router for swaps |
| `modifyLiquidityRouter` | `PoolModifyLiquidityTest` | Test router for liquidity operations |
| `donateRouter` | `PoolDonateTest` | Test router for donations |
| `currency0`, `currency1` | `Currency` | Sorted test ERC-20 tokens (currency0 < currency1) |
| `SQRT_PRICE_1_1` | `uint160` | sqrtPriceX96 for a 1:1 price ratio |
| `SQRT_PRICE_1_2` | `uint160` | sqrtPriceX96 for a 1:2 price ratio |
| `SQRT_PRICE_2_1` | `uint160` | sqrtPriceX96 for a 2:1 price ratio |
| `SQRT_PRICE_1_4` | `uint160` | sqrtPriceX96 for a 1:4 price ratio |
| `SQRT_PRICE_4_1` | `uint160` | sqrtPriceX96 for a 4:1 price ratio |
| `ZERO_BYTES` | `bytes` | Empty bytes constant for hookData |
| `MAX_TICK_SPACING` | `int24` | Maximum allowed tick spacing |

### Key Deployer Functions

```solidity
// Deploy PoolManager + all test routers
deployFreshManagerAndRouters();

// Deploy two sorted ERC-20 tokens, mint to address(this), approve all routers
deployMintAndApprove2Currencies();

// Deploy PoolManager only
deployFreshManager();
```

## HookMiner for Address Mining

Hook addresses encode permissions in their leading bits. `HookMiner` brute-forces a CREATE2 salt that produces an address with the correct bit pattern.

```solidity
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

function _deployHook() internal {
    uint160 flags = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_INITIALIZE_FLAG
    );

    bytes memory constructorArgs = abi.encode(manager);
    (address hookAddress, bytes32 salt) = HookMiner.find(
        address(this),
        flags,
        type(MyHook).creationCode,
        constructorArgs
    );

    hook = new MyHook{salt: salt}(manager);
    require(address(hook) == hookAddress, "hook address mismatch");
}
```

### Common Flag Combinations

```solidity
// Swap-only hook
uint160 swapFlags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

// Liquidity management hook
uint160 liqFlags = uint160(
    Hooks.BEFORE_ADD_LIQUIDITY_FLAG
    | Hooks.AFTER_ADD_LIQUIDITY_FLAG
    | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
    | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
);

// Full lifecycle hook
uint160 fullFlags = uint160(
    Hooks.BEFORE_INITIALIZE_FLAG
    | Hooks.AFTER_INITIALIZE_FLAG
    | Hooks.BEFORE_SWAP_FLAG
    | Hooks.AFTER_SWAP_FLAG
    | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
    | Hooks.AFTER_ADD_LIQUIDITY_FLAG
    | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
    | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
);

// Hook that modifies swap deltas
uint160 deltaFlags = uint160(
    Hooks.BEFORE_SWAP_FLAG
    | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
);
```

## Swap Test Patterns

### Exact Input — zeroForOne

```solidity
function test_swapExactInput_zeroForOne() public {
    uint256 balance0Before = currency0.balanceOf(address(this));
    uint256 balance1Before = currency1.balanceOf(address(this));

    BalanceDelta delta = swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,  // positive = exact input
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        }),
        ZERO_BYTES
    );

    assertLt(delta.amount0(), 0, "should spend token0");
    assertGt(delta.amount1(), 0, "should receive token1");
    assertLt(currency0.balanceOf(address(this)), balance0Before, "token0 balance decreased");
    assertGt(currency1.balanceOf(address(this)), balance1Before, "token1 balance increased");
}
```

### Exact Output — oneForZero

```solidity
function test_swapExactOutput_oneForZero() public {
    BalanceDelta delta = swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -0.5 ether,  // negative = exact output
            sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );

    assertEq(delta.amount0(), -0.5 ether, "should receive exactly 0.5 token0");
    assertGt(delta.amount1(), 0, "should spend token1");
}
```

### Swap Direction Reference

| `zeroForOne` | `amountSpecified` | Meaning |
|---|---|---|
| `true` | `> 0` | Exact input of token0, receive token1 |
| `true` | `< 0` | Receive exact output of token1, spend token0 |
| `false` | `> 0` | Exact input of token1, receive token0 |
| `false` | `< 0` | Receive exact output of token0, spend token1 |

### Price Limits

Always set price limits to avoid reverts:

```solidity
// zeroForOne = true → price goes DOWN → use MIN as limit
sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1

// zeroForOne = false → price goes UP → use MAX as limit
sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
```

### Fuzz Testing Swaps

```solidity
function testFuzz_swap(uint256 amountIn, bool zeroForOne) public {
    amountIn = bound(amountIn, 1e15, 5 ether);

    uint160 priceLimit = zeroForOne
        ? TickMath.MIN_SQRT_PRICE + 1
        : TickMath.MAX_SQRT_PRICE - 1;

    BalanceDelta delta = swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(amountIn),
            sqrtPriceLimitX96: priceLimit
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );

    if (zeroForOne) {
        assertLt(delta.amount0(), 0);
        assertGt(delta.amount1(), 0);
    } else {
        assertGt(delta.amount0(), 0);
        assertLt(delta.amount1(), 0);
    }
}
```

## Liquidity Test Patterns

### Adding Liquidity

```solidity
function test_addLiquidity() public {
    uint256 balance0Before = currency0.balanceOf(address(this));
    uint256 balance1Before = currency1.balanceOf(address(this));

    BalanceDelta delta = modifyLiquidityRouter.modifyLiquidity(
        key,
        IPoolManager.ModifyLiquidityParams({
            tickLower: -600,
            tickUpper: 600,
            liquidityDelta: 5 ether,
            salt: bytes32(0)
        }),
        ZERO_BYTES
    );

    assertLt(delta.amount0(), 0, "should deposit token0");
    assertLt(delta.amount1(), 0, "should deposit token1");
    assertLt(currency0.balanceOf(address(this)), balance0Before);
    assertLt(currency1.balanceOf(address(this)), balance1Before);
}
```

### Removing Liquidity

```solidity
function test_removeLiquidity() public {
    uint256 balance0Before = currency0.balanceOf(address(this));
    uint256 balance1Before = currency1.balanceOf(address(this));

    BalanceDelta delta = modifyLiquidityRouter.modifyLiquidity(
        key,
        IPoolManager.ModifyLiquidityParams({
            tickLower: -120,
            tickUpper: 120,
            liquidityDelta: -5 ether,  // negative = remove
            salt: bytes32(0)
        }),
        ZERO_BYTES
    );

    assertGt(delta.amount0(), 0, "should withdraw token0");
    assertGt(delta.amount1(), 0, "should withdraw token1");
    assertGt(currency0.balanceOf(address(this)), balance0Before);
    assertGt(currency1.balanceOf(address(this)), balance1Before);
}
```

### Out-of-Range Liquidity

```solidity
function test_addLiquidity_outOfRange() public {
    (uint160 sqrtPriceX96, int24 currentTick,,) = manager.getSlot0(poolId);

    // Add liquidity entirely above current price (only token1 deposited)
    int24 tickLower = currentTick + 120;
    int24 tickUpper = currentTick + 600;
    // Round to tick spacing
    tickLower = (tickLower / key.tickSpacing) * key.tickSpacing;
    tickUpper = (tickUpper / key.tickSpacing) * key.tickSpacing;

    BalanceDelta delta = modifyLiquidityRouter.modifyLiquidity(
        key,
        IPoolManager.ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: 1 ether,
            salt: bytes32(0)
        }),
        ZERO_BYTES
    );

    assertEq(delta.amount0(), 0, "no token0 for above-range position");
    assertLt(delta.amount1(), 0, "should deposit token1 only");
}
```

## Hook Callback Testing

### Verifying Hook Side Effects

```solidity
function test_hookCalledOnSwap() public {
    uint256 swapCountBefore = hook.swapCount(poolId);

    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );

    assertEq(hook.swapCount(poolId), swapCountBefore + 1, "hook should increment counter");
}
```

### Verifying Hook Receives Correct Parameters

```solidity
function test_hookReceivesCorrectParams() public {
    bytes memory hookData = abi.encode(uint256(42));

    vm.expectEmit(address(hook));
    emit MyHook.BeforeSwapCalled(
        address(swapRouter),
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        hookData
    );

    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        hookData
    );
}
```

### Testing Hooks That Return Deltas

```solidity
function test_hookReturnsDelta() public {
    // For hooks with BEFORE_SWAP_RETURNS_DELTA_FLAG, the hook can take/give tokens
    uint256 hookBalance0Before = currency0.balanceOf(address(hook));

    BalanceDelta delta = swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );

    // Verify the hook captured its fee or modified the delta
    uint256 hookBalance0After = currency0.balanceOf(address(hook));
    assertGt(hookBalance0After, hookBalance0Before, "hook should have taken fee");
}
```

### Testing afterInitialize

```solidity
function test_afterInitialize_setsState() public {
    // Deploy a second pool to test initialization
    PoolKey memory key2 = PoolKey(
        currency0, currency1, 500, 10, IHooks(address(hook))
    );
    manager.initialize(key2, SQRT_PRICE_1_1);
    PoolId id2 = key2.toId();

    assertEq(hook.poolInitTimestamp(id2), block.timestamp);
}
```

## Reading Pool State in Tests

```solidity
using StateLibrary for IPoolManager;

function test_poolStateAfterSwap() public {
    (uint160 sqrtPriceBefore, int24 tickBefore,,) = manager.getSlot0(poolId);

    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );

    (uint160 sqrtPriceAfter, int24 tickAfter, uint24 protocolFee, uint24 lpFee) =
        manager.getSlot0(poolId);

    assertLt(sqrtPriceAfter, sqrtPriceBefore, "price should decrease on zeroForOne swap");
    assertLe(tickAfter, tickBefore, "tick should decrease or stay same");
}

function test_poolLiquidity() public {
    uint128 totalLiquidity = manager.getLiquidity(poolId);
    assertGt(totalLiquidity, 0, "pool should have liquidity from setUp");

    uint128 positionLiquidity = manager.getPositionLiquidity(
        poolId,
        address(modifyLiquidityRouter),
        -120,
        120,
        bytes32(0)
    );
    assertGt(positionLiquidity, 0, "position should have liquidity");
}
```

## Dynamic Fee Hook Testing

```solidity
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";

function test_dynamicFeeHook() public {
    PoolKey memory dynamicKey = PoolKey(
        currency0,
        currency1,
        LPFeeLibrary.DYNAMIC_FEE_FLAG,
        60,
        IHooks(address(hook))
    );
    manager.initialize(dynamicKey, SQRT_PRICE_1_1);

    modifyLiquidityRouter.modifyLiquidity(
        dynamicKey,
        IPoolManager.ModifyLiquidityParams({
            tickLower: -120,
            tickUpper: 120,
            liquidityDelta: 10 ether,
            salt: bytes32(0)
        }),
        ZERO_BYTES
    );

    // Swap under normal conditions → expect base fee
    BalanceDelta delta1 = swapRouter.swap(
        dynamicKey,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );

    // Change conditions that affect fee (e.g., volatility, time)
    vm.warp(block.timestamp + 1 hours);

    BalanceDelta delta2 = swapRouter.swap(
        dynamicKey,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );

    // Under higher volatility the fee should differ
    // (exact assertion depends on hook logic)
}
```

## Fork Testing Against Production Pools

```solidity
contract V4ForkTest is Test {
    using StateLibrary for IPoolManager;

    IPoolManager constant PM = IPoolManager(0x000000000004444c5dc75cB358380D2e3de08A90);

    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"), 21_000_000);
    }

    function test_productionPoolState() public view {
        // Construct the key for an existing pool
        PoolKey memory liveKey = PoolKey({
            currency0: Currency.wrap(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48), // USDC
            currency1: Currency.wrap(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2), // WETH
            fee: 3000,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });

        PoolId liveId = PoolIdLibrary.toId(liveKey);
        (uint160 sqrtPriceX96, int24 tick,,) = PM.getSlot0(liveId);
        assertGt(sqrtPriceX96, 0, "pool should exist");
    }

    function test_deployHookAgainstProductionPM() public {
        // Deploy your hook to work with the production PoolManager
        // Useful for integration testing with real pool state
    }
}
```

## Gas Profiling

### CLI Commands

```bash
# Gas report for all hook tests
forge test --gas-report --match-contract MyHookTest

# Snapshot current gas usage
forge snapshot --match-contract MyHookTest

# Compare against baseline
forge snapshot --diff .gas-snapshot

# Fail if gas increased beyond threshold
forge snapshot --check --tolerance 5
```

### In-Test Gas Measurement

```solidity
function test_hookGasOverhead() public {
    uint256 gasBefore = gasleft();
    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
    uint256 gasUsed = gasBefore - gasleft();

    emit log_named_uint("swap gas with hook", gasUsed);
    assertLt(gasUsed, 200_000, "total swap gas too high");
}

function test_compareGasWithAndWithoutHook() public {
    // Pool with hook
    uint256 gasBefore = gasleft();
    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
    uint256 gasWithHook = gasBefore - gasleft();

    // Pool without hook (no-op hook address)
    PoolKey memory bareKey = PoolKey(
        currency0, currency1, 3000, 60, IHooks(address(0))
    );
    manager.initialize(bareKey, SQRT_PRICE_1_1);
    modifyLiquidityRouter.modifyLiquidity(
        bareKey,
        IPoolManager.ModifyLiquidityParams({
            tickLower: -120, tickUpper: 120,
            liquidityDelta: 10 ether, salt: bytes32(0)
        }),
        ZERO_BYTES
    );

    gasBefore = gasleft();
    swapRouter.swap(
        bareKey,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
    uint256 gasWithoutHook = gasBefore - gasleft();

    uint256 overhead = gasWithHook - gasWithoutHook;
    emit log_named_uint("hook overhead (gas)", overhead);
    assertLt(overhead, 50_000, "hook gas overhead too high");
}
```

## Invariant Testing for Hooks

### Handler Contract

```solidity
contract HookHandler is Test, Deployers {
    using PoolIdLibrary for PoolKey;

    MyHook public hook;
    PoolKey public key;

    constructor(MyHook _hook, PoolKey memory _key) {
        hook = _hook;
        key = _key;
    }

    function swap(uint256 amountSeed, bool zeroForOne) external {
        uint256 amount = bound(amountSeed, 1e15, 2 ether);

        uint160 priceLimit = zeroForOne
            ? TickMath.MIN_SQRT_PRICE + 1
            : TickMath.MAX_SQRT_PRICE - 1;

        try swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: int256(amount),
                sqrtPriceLimitX96: priceLimit
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        ) {} catch {}
    }

    function addLiquidity(uint256 liquiditySeed) external {
        uint256 liquidity = bound(liquiditySeed, 1e16, 5 ether);
        try modifyLiquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: int256(liquidity),
                salt: bytes32(0)
            }),
            ZERO_BYTES
        ) {} catch {}
    }
}
```

### Invariant Test Contract

```solidity
contract MyHookInvariantTest is Test, Deployers {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    MyHook hook;
    PoolKey key;
    PoolId poolId;
    HookHandler handler;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        _deployHook();

        key = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        manager.initialize(key, SQRT_PRICE_1_1);
        poolId = key.toId();

        modifyLiquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -600, tickUpper: 600,
                liquidityDelta: 100 ether, salt: bytes32(0)
            }),
            ZERO_BYTES
        );

        handler = new HookHandler(hook, key);

        // Fund handler
        currency0.transfer(address(handler), 1000 ether);
        currency1.transfer(address(handler), 1000 ether);

        targetContract(address(handler));
    }

    function invariant_poolManagerSolvent() public view {
        uint256 pm0 = currency0.balanceOf(address(manager));
        uint256 pm1 = currency1.balanceOf(address(manager));
        assertGe(pm0, 0, "PoolManager should never have negative token0");
        assertGe(pm1, 0, "PoolManager should never have negative token1");
    }

    function invariant_hookStateConsistent() public view {
        // Hook per-pool state should remain internally consistent
        uint256 totalSwaps = hook.swapCount(poolId);
        assertGe(totalSwaps, 0, "swap count should be non-negative");
    }

    function invariant_priceWithinBounds() public view {
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(poolId);
        assertGe(sqrtPriceX96, TickMath.MIN_SQRT_PRICE);
        assertLe(sqrtPriceX96, TickMath.MAX_SQRT_PRICE);
    }
}
```

### Foundry Invariant Config

In `foundry.toml`:

```toml
[invariant]
runs = 256
depth = 64
fail_on_revert = false
```

## Testing HookData Pass-Through

Hooks receive arbitrary `bytes calldata hookData` — test that your hook correctly parses and acts on it.

```solidity
function test_hookDataPassedToBeforeSwap() public {
    bytes memory hookData = abi.encode(address(this), uint256(100));

    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        hookData
    );

    // Assert hook decoded and used the data
    assertEq(hook.lastCaller(poolId), address(this));
    assertEq(hook.lastParam(poolId), 100);
}

function test_emptyHookData() public {
    // Hook should handle empty hookData gracefully
    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
}
```

## Testing Revert Conditions

```solidity
function test_revert_uninitializedPool() public {
    PoolKey memory badKey = PoolKey(
        currency0, currency1, 500, 10, IHooks(address(hook))
    );
    // Pool not initialized — swap should revert
    vm.expectRevert();
    swapRouter.swap(
        badKey,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
}

function test_revert_swapZeroAmount() public {
    vm.expectRevert();
    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 0,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
}

function test_revert_hookCustomError() public {
    // If the hook enforces conditions via custom errors
    vm.expectRevert(abi.encodeWithSelector(MyHook.SwapPaused.selector, poolId));
    hook.setPaused(poolId, true);
    swapRouter.swap(
        key,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
}
```

## Native ETH (Currency.wrap(address(0))) Pools

```solidity
function test_nativeETHPool() public {
    PoolKey memory ethKey = PoolKey(
        CurrencyLibrary.ADDRESS_ZERO,  // native ETH as currency0
        currency1,
        3000,
        60,
        IHooks(address(0))
    );
    manager.initialize(ethKey, SQRT_PRICE_1_1);

    modifyLiquidityRouter.modifyLiquidity{value: 10 ether}(
        ethKey,
        IPoolManager.ModifyLiquidityParams({
            tickLower: -120,
            tickUpper: 120,
            liquidityDelta: 10 ether,
            salt: bytes32(0)
        }),
        ZERO_BYTES
    );

    swapRouter.swap{value: 1 ether}(
        ethKey,
        IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
        ZERO_BYTES
    );
}
```

## Test File Organization

```
test/
├── unit/
│   ├── MyHook.t.sol              # Core hook logic tests
│   └── MyHookPermissions.t.sol   # Permission and access tests
├── integration/
│   ├── SwapWithHook.t.sol        # Swap integration tests
│   └── LiquidityWithHook.t.sol   # Liquidity integration tests
├── invariant/
│   ├── handlers/HookHandler.sol  # Invariant handler
│   └── MyHook.invariant.t.sol    # Invariant properties
├── fork/
│   └── V4Mainnet.t.sol           # Fork tests against production
└── helpers/
    └── HookTestBase.sol          # Shared setUp and utilities
```

### Shared Base Contract

```solidity
abstract contract HookTestBase is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    MyHook hook;
    PoolKey key;
    PoolId poolId;

    function setUp() public virtual {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        _deployHook();

        key = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        manager.initialize(key, SQRT_PRICE_1_1);
        poolId = key.toId();
    }

    function _deployHook() internal {
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_INITIALIZE_FLAG
        );
        bytes memory constructorArgs = abi.encode(manager);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this), flags, type(MyHook).creationCode, constructorArgs
        );
        hook = new MyHook{salt: salt}(manager);
        require(address(hook) == hookAddress, "hook address mismatch");
    }

    function _seedLiquidity() internal {
        modifyLiquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -600, tickUpper: 600,
                liquidityDelta: 100 ether, salt: bytes32(0)
            }),
            ZERO_BYTES
        );
    }

    function _swapExactIn(bool zeroForOne, uint256 amount) internal returns (BalanceDelta) {
        return swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: int256(amount),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
    }
}
```

## Hook Testing Checklist

- [ ] **Setup**: `deployFreshManagerAndRouters()` and `deployMintAndApprove2Currencies()` called
- [ ] **Address mining**: Hook deployed via HookMiner with correct permission flags
- [ ] **Permissions**: `getHookPermissions()` matches the mined address bits
- [ ] **Return selectors**: Every callback returns its own `BaseHook.<function>.selector`
- [ ] **Swap: exact input zeroForOne**: token0 spent, token1 received
- [ ] **Swap: exact input oneForZero**: token1 spent, token0 received
- [ ] **Swap: exact output zeroForOne**: exact token1 received
- [ ] **Swap: exact output oneForZero**: exact token0 received
- [ ] **Liquidity: add in-range**: both tokens deposited
- [ ] **Liquidity: add out-of-range**: only one token deposited
- [ ] **Liquidity: remove**: tokens returned to LP
- [ ] **Hook state**: per-pool state updated correctly on callbacks
- [ ] **hookData**: arbitrary bytes decoded and used correctly
- [ ] **Empty hookData**: hook handles `ZERO_BYTES` without reverting
- [ ] **Dynamic fees**: fee varies under different conditions when DYNAMIC_FEE_FLAG set
- [ ] **Delta returns**: hooks with RETURNS_DELTA flags modify swap/liquidity amounts correctly
- [ ] **Revert paths**: invalid inputs, paused states, and unauthorized access revert correctly
- [ ] **Native ETH**: pool with `Currency.wrap(address(0))` works with hook
- [ ] **Gas overhead**: hook callbacks measured under 50K gas each via `forge snapshot`
- [ ] **Gas comparison**: overhead vs no-hook pool documented
- [ ] **Invariant: PM solvency**: PoolManager balances never go negative
- [ ] **Invariant: price bounds**: sqrtPriceX96 stays within [MIN, MAX]
- [ ] **Invariant: hook state**: per-pool counters and accumulators remain consistent
- [ ] **Fork test**: hook tested against production PoolManager on mainnet fork
- [ ] **Fuzz tests**: swaps and liquidity ops fuzzed with `bound()` for amount ranges
