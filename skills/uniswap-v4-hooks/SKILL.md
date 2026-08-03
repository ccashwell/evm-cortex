---
name: uniswap-v4-hooks
description: Use when building Uniswap V4 hooks, custom AMM logic, dynamic fee strategies, access control hooks, oracle hooks, or integrating custom logic with the V4 singleton pool. Covers all 14 permission flags, 10 callback functions, return-delta mechanics, custom accounting, address mining, and Foundry testing patterns.
---

# Uniswap V4 Hook Development

## Architecture Overview

Uniswap V4 uses a singleton `PoolManager` contract. All pools live inside one contract, and hooks are external contracts called at specific lifecycle points. Each pool has exactly one hook (or none). A single hook contract can serve unlimited pools.

Hook addresses encode their permissions in the **leading bits** of the address. This is enforced at pool creation — the PoolManager validates that the hook address's leading bytes match the declared permissions. Deploy hooks via `CREATE2` with a mined salt.

## Hook Permission Flags

```solidity
import {Hooks} from "v4-core/src/libraries/Hooks.sol";

struct Permissions {
    bool beforeInitialize;               // called before pool creation
    bool afterInitialize;                // called after pool creation
    bool beforeAddLiquidity;             // called before LP adds
    bool afterAddLiquidity;              // called after LP adds
    bool beforeRemoveLiquidity;          // called before LP removes
    bool afterRemoveLiquidity;           // called after LP removes
    bool beforeSwap;                     // called before every swap
    bool afterSwap;                      // called after every swap
    bool beforeDonate;                   // called before donate()
    bool afterDonate;                    // called after donate()
    bool beforeSwapReturnDelta;          // hook can modify swap input amounts
    bool afterSwapReturnDelta;           // hook can take a cut of swap output
    bool afterAddLiquidityReturnDelta;   // hook can modify LP deposit amounts
    bool afterRemoveLiquidityReturnDelta; // hook can modify LP withdrawal amounts
}
```

### Permission Flag Constants (from Hooks.sol)
```solidity
uint160 constant BEFORE_INITIALIZE_FLAG      = 1 << 159;
uint160 constant AFTER_INITIALIZE_FLAG       = 1 << 158;
uint160 constant BEFORE_ADD_LIQUIDITY_FLAG   = 1 << 157;
uint160 constant AFTER_ADD_LIQUIDITY_FLAG    = 1 << 156;
uint160 constant BEFORE_REMOVE_LIQUIDITY_FLAG = 1 << 155;
uint160 constant AFTER_REMOVE_LIQUIDITY_FLAG = 1 << 154;
uint160 constant BEFORE_SWAP_FLAG            = 1 << 153;
uint160 constant AFTER_SWAP_FLAG             = 1 << 152;
uint160 constant BEFORE_DONATE_FLAG          = 1 << 151;
uint160 constant AFTER_DONATE_FLAG           = 1 << 150;
uint160 constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 149;
uint160 constant AFTER_SWAP_RETURNS_DELTA_FLAG  = 1 << 148;
uint160 constant AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG    = 1 << 147;
uint160 constant AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 146;
```

## Complete Callback Signatures

```solidity
function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
    external returns (bytes4);

function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
    external returns (bytes4);

function beforeAddLiquidity(address sender, PoolKey calldata key, IPoolManager.ModifyLiquidityParams calldata params, bytes calldata hookData)
    external returns (bytes4);

function afterAddLiquidity(address sender, PoolKey calldata key, IPoolManager.ModifyLiquidityParams calldata params, BalanceDelta delta, BalanceDelta feesAccrued, bytes calldata hookData)
    external returns (bytes4, BalanceDelta);

function beforeRemoveLiquidity(address sender, PoolKey calldata key, IPoolManager.ModifyLiquidityParams calldata params, bytes calldata hookData)
    external returns (bytes4);

function afterRemoveLiquidity(address sender, PoolKey calldata key, IPoolManager.ModifyLiquidityParams calldata params, BalanceDelta delta, BalanceDelta feesAccrued, bytes calldata hookData)
    external returns (bytes4, BalanceDelta);

function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
    external returns (bytes4, BeforeSwapDelta, uint24);

function afterSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
    external returns (bytes4, int128);

function beforeDonate(address sender, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
    external returns (bytes4);

function afterDonate(address sender, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
    external returns (bytes4);
```

## API Compatibility Note

The snippets below use the older `BaseHook` override style (`external override onlyPoolManager`).
Current `v4-periphery` `BaseHook` marks the external callbacks **non-virtual** and applies
`onlyPoolManager` itself — you override the `internal virtual` variants instead, and the
param structs moved to `v4-core/src/types/PoolOperation.sol`:

```solidity
// current style — override the internal hook, no modifier needed
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";  // not IPoolManager.SwapParams

function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
    internal override returns (bytes4, BeforeSwapDelta, uint24)
{
    return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
}
```

The logic in each pattern below is unaffected by which style you use.

## Hook Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SafeCast} from "v4-core/src/libraries/SafeCast.sol";

contract MyHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    mapping(PoolId => uint256) public swapCount;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function afterInitialize(
        address sender,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24 tick
    ) external override onlyPoolManager returns (bytes4) {
        swapCount[key.toId()] = 0;
        return this.afterInitialize.selector;
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4, int128) {
        swapCount[key.toId()]++;
        return (this.afterSwap.selector, 0);
    }
}
```

## Hook Pattern: Dynamic Fees

```solidity
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";

contract DynamicFeeHook is BaseHook {
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false, afterInitialize: false,
            beforeAddLiquidity: false, afterAddLiquidity: false,
            beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
            beforeSwap: true, afterSwap: false,
            beforeDonate: false, afterDonate: false,
            beforeSwapReturnDelta: false, afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint24 fee = _calculateFee(key);
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _calculateFee(PoolKey calldata key) internal view returns (uint24) {
        uint256 vol = _getVolatility(key.toId());
        if (vol > 1000) return 10000;  // 1.00%
        if (vol > 500) return 3000;    // 0.30%
        return 500;                     // 0.05%
    }
}
```

Pool must be created with `LPFeeLibrary.DYNAMIC_FEE_FLAG` as the fee in the PoolKey.

## Hook Pattern: Access Control (KYC/Allowlist)

> **`sender` is the caller of the PoolManager, not the end user.** For any swap routed
> through periphery (`UniversalRouter`, `PoolSwapTest`, an aggregator), `sender` is the
> **router address** — never the swapper. Gating on `allowed[sender]` therefore allowlists
> *routers*: one allowlisted router lets the entire world swap, while allowlisted users
> cannot swap at all unless they call the PoolManager directly.
>
> To gate the economic user you must (a) restrict `sender` to routers you trust to report
> the user faithfully, and (b) read the user identity from `hookData`. `hookData` is
> attacker-controlled on any other path, so it is only trustworthy behind (a).

```solidity
contract AllowlistHook is BaseHook {
    mapping(address => bool) public allowed;
    mapping(address => bool) public trustedRouter; // routers that faithfully encode the user
    address public admin;

    error UntrustedRouter(address sender);
    error NotAllowed(address user);

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false, afterInitialize: false,
            beforeAddLiquidity: true, afterAddLiquidity: false,
            beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
            beforeSwap: true, afterSwap: false,
            beforeDonate: false, afterDonate: false,
            beforeSwapReturnDelta: false, afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Resolves the economic user behind a callback. Only a trusted router's
    /// hookData may be believed; every other caller is treated as the user itself.
    function _resolveUser(address sender, bytes calldata hookData) internal view returns (address) {
        if (hookData.length == 0) return sender; // direct PoolManager caller: sender IS the user
        if (!trustedRouter[sender]) revert UntrustedRouter(sender);
        return abi.decode(hookData, (address));
    }

    function beforeSwap(address sender, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata hookData)
        external view override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        address user = _resolveUser(sender, hookData);
        if (!allowed[user]) revert NotAllowed(user);
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function beforeAddLiquidity(address sender, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata hookData)
        external view override onlyPoolManager returns (bytes4)
    {
        address user = _resolveUser(sender, hookData);
        if (!allowed[user]) revert NotAllowed(user);
        return this.beforeAddLiquidity.selector;
    }
}
```

## Hook Pattern: Oracle / TWAP

```solidity
contract OracleHook is BaseHook {
    struct Observation {
        uint32 blockTimestamp;
        int56 tickCumulative;
    }

    mapping(PoolId => Observation[]) public observations;

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false, afterInitialize: true,
            beforeAddLiquidity: false, afterAddLiquidity: false,
            beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
            beforeSwap: false, afterSwap: true,
            beforeDonate: false, afterDonate: false,
            beforeSwapReturnDelta: false, afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
        });
    }

    function afterSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        PoolId id = key.toId();
        (, int24 tick,,) = poolManager.getSlot0(id);
        Observation[] storage obs = observations[id];
        if (obs.length == 0 || obs[obs.length - 1].blockTimestamp != uint32(block.timestamp)) {
            int56 lastCumulative = obs.length > 0 ? obs[obs.length - 1].tickCumulative : int56(0);
            uint32 lastTimestamp = obs.length > 0 ? obs[obs.length - 1].blockTimestamp : uint32(block.timestamp);
            uint32 elapsed = uint32(block.timestamp) - lastTimestamp;
            obs.push(Observation({
                blockTimestamp: uint32(block.timestamp),
                tickCumulative: lastCumulative + int56(tick) * int56(int32(elapsed))
            }));
        }
        return (this.afterSwap.selector, 0);
    }

    function consult(PoolKey calldata key, uint32 secondsAgo) external view returns (int24 arithmeticMeanTick) {
        // Binary search observations for the two relevant timestamps, compute TWAP
    }
}
```

## Hook Pattern: Hook-Collected Swap Fee (afterSwapReturnDelta)

> **The `int128` returned by `afterSwap` always applies to the *unspecified* currency**,
> which flips with both swap direction and exact-in/exact-out. Reading the output leg and
> returning it as the fee charges the fee against the *other* token on exact-output swaps.
>
> | swap | specified | unspecified |
> |---|---|---|
> | exact input, zeroForOne | currency0 (in) | currency1 (out) |
> | exact input, oneForZero | currency1 (in) | currency0 (out) |
> | exact output, zeroForOne | currency1 (out) | currency0 (in) |
> | exact output, oneForZero | currency0 (out) | currency1 (in) |
>
> The returned delta also **credits the hook inside the PoolManager — it is not a transfer**.
> The hook must `take()` that credit in the same callback, or the currency's delta stays
> nonzero and the whole swap reverts with `CurrencyNotSettled()`.

```solidity
contract SwapFeeHook is BaseHook {
    using SafeCast for uint256;

    uint256 public constant HOOK_FEE_BPS = 10;    // 0.10% hook fee
    uint256 public constant TOTAL_BPS = 10_000;

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false, afterInitialize: false,
            beforeAddLiquidity: false, afterAddLiquidity: false,
            beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
            beforeSwap: false, afterSwap: true,
            beforeDonate: false, afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,  // CRITICAL: must be true to modify output
            afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
        });
    }

    function afterSwap(
        address, PoolKey calldata key, IPoolManager.SwapParams calldata params,
        BalanceDelta delta, bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        // The fee is charged in the UNSPECIFIED currency, so resolve which one that is.
        // currency0 is the specified currency exactly when exactInput == zeroForOne.
        bool currency0Specified = (params.amountSpecified < 0) == params.zeroForOne;
        (Currency currencyUnspecified, int128 amountUnspecified) = currency0Specified
            ? (key.currency1, delta.amount1())
            : (key.currency0, delta.amount0());

        // On exact-output swaps the unspecified leg is the input the user owes (negative).
        if (amountUnspecified < 0) amountUnspecified = -amountUnspecified;
        if (amountUnspecified == 0) return (this.afterSwap.selector, 0);

        uint256 feeAmount = (uint256(uint128(amountUnspecified)) * HOOK_FEE_BPS) / TOTAL_BPS;

        // Positive return credits the hook; take() converts that credit into real tokens.
        // Without this take() the delta never zeroes and the swap reverts.
        poolManager.take(currencyUnspecified, address(this), feeAmount);
        return (this.afterSwap.selector, feeAmount.toInt128());
    }
}
```

## Hook Pattern: Custom Curve (beforeSwapReturnDelta)

Use `beforeSwapReturnDelta` to completely replace the concentrated liquidity curve with custom pricing:

> **The two `BeforeSwapDelta` legs carry opposite signs, and the hook must move the tokens
> itself.** `toBeforeSwapDelta(-amountSpecified, +amountSpecified)` no-ops the concentrated
> liquidity swap: the specified leg cancels the user's requested amount, the unspecified leg
> is what the hook owes back. Giving both legs the same sign claims *both* currencies from
> the swapper. The hook must also `take()` the input and `settle()` the output in the same
> callback — the delta is an accounting entry, not a transfer, so an unresolved leg reverts
> the swap with `CurrencyNotSettled()`.
>
> A no-op'd curve makes the hook the entire AMM: conservation, available liquidity, pricing,
> slippage, exact-output fills, and rounding are now all your responsibility.

```solidity
// import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
// import {CurrencySettler} from "v4-core/test/utils/CurrencySettler.sol";

contract ConstantSumHook is BaseHook {
    using CurrencySettler for Currency;

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false, afterInitialize: false,
            beforeAddLiquidity: true, afterAddLiquidity: false,
            beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
            beforeSwap: true, afterSwap: false,
            beforeDonate: false, afterDonate: false,
            beforeSwapReturnDelta: true,  // hook provides its own swap amounts
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        // Constant-sum: 1 token0 always equals 1 token1 (stablecoin peg)
        (Currency inputCurrency, Currency outputCurrency) = params.zeroForOne
            ? (key.currency0, key.currency1)
            : (key.currency1, key.currency0);
        uint256 absAmount = params.amountSpecified > 0
            ? uint256(int256(params.amountSpecified))
            : uint256(int256(-params.amountSpecified));

        // Move the tokens: pull the full input in, pay the equal output back out.
        poolManager.take(inputCurrency, address(this), absAmount);
        outputCurrency.settle(poolManager, address(this), absAmount, false);

        // BeforeSwapDelta(specifiedDelta, unspecifiedDelta) — OPPOSITE signs.
        // -amountSpecified cancels the requested amount (no-ops the CL swap);
        // +amountSpecified is the equal-and-opposite amount the hook owes back.
        BeforeSwapDelta hookDelta = toBeforeSwapDelta(
            int128(-params.amountSpecified),
            int128(params.amountSpecified)
        );
        return (this.beforeSwap.selector, hookDelta, 0);
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4)
    {
        revert("use hook's own liquidity mechanism");
    }
}
```

## Hook Pattern: TWAMM (Time-Weighted Average Market Maker)

```solidity
struct LongTermOrder {
    address owner;
    bool zeroForOne;
    uint256 sellRate;       // tokens per second
    uint256 expirationTime;
    uint256 unfilledAmount;
}

mapping(PoolId => LongTermOrder[]) public orders;
mapping(PoolId => uint256) public lastVirtualExecutionTime;

function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
    external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
{
    _executePendingVirtualOrders(key);
    return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
}

function _executePendingVirtualOrders(PoolKey calldata key) internal {
    PoolId id = key.toId();
    uint256 elapsed = block.timestamp - lastVirtualExecutionTime[id];
    if (elapsed == 0) return;

    // Sum sell rates for each direction, execute against pool
    // Uses poolManager.swap() internally within the unlock context
    lastVirtualExecutionTime[id] = block.timestamp;
}
```

## Hook Pattern: Limit Orders

```solidity
struct LimitOrder {
    address owner;
    bool zeroForOne;
    int24 tick;
    uint256 amount;
}

mapping(PoolId => mapping(int24 => mapping(bool => uint256))) public tickLiquidity;

function afterSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, BalanceDelta, bytes calldata)
    external override onlyPoolManager returns (bytes4, int128)
{
    (, int24 currentTick,,) = poolManager.getSlot0(key.toId());
    _fillCrossedOrders(key, currentTick, params.zeroForOne);
    return (this.afterSwap.selector, 0);
}
```

## Hook Pattern: Auto-Compounding LP Fees

```solidity
function afterSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
    external override onlyPoolManager returns (bytes4, int128)
{
    PoolId id = key.toId();
    uint256 feesCollected = _getAccruedFees(id);
    if (feesCollected > MIN_COMPOUND_THRESHOLD) {
        _reinvestFees(key, feesCollected);
    }
    return (this.afterSwap.selector, 0);
}
```

## Address Mining for Hook Deployment

```solidity
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

// Compute flags from your permissions
uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

bytes memory constructorArgs = abi.encode(poolManager);
(address hookAddress, bytes32 salt) = HookMiner.find(
    address(this),
    flags,
    type(MyHook).creationCode,
    constructorArgs
);

MyHook hook = new MyHook{salt: salt}(poolManager);
assert(address(hook) == hookAddress);
```

### Manual Mining (alternative)
```solidity
bytes memory creationCode = abi.encodePacked(type(MyHook).creationCode, abi.encode(poolManager));
bytes32 initCodeHash = keccak256(creationCode);

for (uint256 salt = 0; ; salt++) {
    address predicted = address(uint160(uint256(keccak256(
        abi.encodePacked(bytes1(0xff), deployer, bytes32(salt), initCodeHash)
    ))));
    if (Hooks.validateHookPermissions(IHooks(predicted), getHookPermissions())) {
        break;
    }
}
```

## Testing Hooks with Foundry

```solidity
import "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract MyHookTest is Test, Deployers {
    MyHook hook;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_INITIALIZE_FLAG);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this), flags, type(MyHook).creationCode, abi.encode(manager)
        );
        hook = new MyHook{salt: salt}(manager);

        PoolKey memory key = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        manager.initialize(key, SQRT_PRICE_1_1);

        modifyLiquidityRouter.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams(-120, 120, 10 ether, 0), "");
    }

    function test_hookCalledOnSwap() public {
        PoolKey memory key = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        swapRouter.swap(key, IPoolManager.SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false), "");
        assertEq(hook.swapCount(key.toId()), 1);
    }
}
```

## Security Considerations

- **onlyPoolManager**: Always use the `onlyPoolManager` modifier on callbacks — never allow direct calls
- **`sender` is not the user**: `sender` is whoever called the PoolManager — a router, an aggregator, or an attacker's own unlocker contract. Never use it for user-level authorization or accounting. Resolve the economic user via a trusted-router + `hookData` pattern
- **`hookData` is untrusted**: anyone can initialize a pool on your hook and pass arbitrary `hookData` through a direct PoolManager call. Only believe it when `sender` is a router you trust to encode it faithfully
- **Return deltas are credits, not transfers**: a nonzero returned delta accounts value to the *hook's* address inside the PoolManager. The hook must `take()` or `settle()` it in the same callback, or the currency delta stays nonzero and the operation reverts with `CurrencyNotSettled()`
- **Deltas apply to the unspecified currency**: which token that is flips with direction *and* exact-in/exact-out. Derive it (`currency0Specified = (amountSpecified < 0) == zeroForOne`); never assume it's the output
- **Reentrancy via unlock**: Hooks execute within an `unlock` context. Don't call `poolManager.unlock()` from a hook callback
- **State isolation**: Per-pool state must use `PoolId` as the key. Never use global state for pool-specific data
- **Gas budget**: Each hook callback adds gas to every swap/LP operation. Keep callbacks under 50K gas. Profile with `forge test --gas-report`
- **MEV exposure**: `beforeSwap` hooks that read onchain state (e.g., oracle prices) can be manipulated. Use commit-reveal or time delays for price-sensitive logic
- **Return values**: Must return the correct function selector. Wrong selector = revert
- **Custom accounting invariants**: If returning non-zero deltas, prove mathematically that value is conserved across all paths

## Checklist

- [ ] `getHookPermissions()` matches address leading bits (verified with HookMiner)
- [ ] All implemented callbacks have `onlyPoolManager` modifier
- [ ] All callbacks return correct function selector
- [ ] Return-delta hooks (beforeSwapReturnDelta, afterSwapReturnDelta) conserve value
- [ ] Every returned delta is resolved with `take()`/`settle()` in the same callback
- [ ] Unspecified currency derived, not assumed — verified in all four swap quadrants
- [ ] No user-level authorization or accounting keyed on the `sender` argument
- [ ] `hookData` validated, or only trusted behind an allowlisted router
- [ ] Dynamic fees bounded within [0, MAX_LP_FEE] (1_000_000)
- [ ] Per-pool state keyed by PoolId, not global
- [ ] No reentrancy via `poolManager.unlock()` from callbacks
- [ ] Tested with exact-input AND exact-output swaps in both directions
- [ ] Tested with multiple pools sharing the same hook contract
- [ ] Gas overhead per callback measured and under 50K
- [ ] Hook works with native ETH pools (Currency = address(0))
- [ ] hookData parameter properly passed through from caller
- [ ] Fork-tested against production PoolManager
- [ ] Address mining salt documented for reproducible deployment
