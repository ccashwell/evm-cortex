---
name: uniswap-v4-expert
description: Use when building on, integrating with, or analyzing Uniswap V4. Covers PoolManager singleton architecture, flash accounting via EIP-1153 transient storage, hook lifecycle, PoolKey structure, Currency type, dynamic fees, custom accounting, native ETH support, PositionManager (ERC-721 positions), and production deployment addresses.
---

# Uniswap V4 Expert

## Architecture Overview

Uniswap V4 replaces V3's factory-per-pool model with a **singleton PoolManager** — every pool lives inside a single contract. This eliminates redundant bytecode deployments and enables multi-hop swaps to settle only net token transfers. All state-changing operations use **flash accounting** via EIP-1153 transient storage: callers accumulate deltas during an `unlock()` callback and must zero out all balances before the callback returns.

### Singleton Design

```
┌────────────────────────────────────────────┐
│                 PoolManager                │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐   │
│  │  Pool A  │ │  Pool B   │ │  Pool C  │   │
│  │ ETH/USDC │ │ WBTC/USDC │ │ ETH/DAI  │   │
│  └──────────┘ └───────────┘ └──────────┘   │
│                                            │
│  Transient Storage (EIP-1153)              │
│  ┌──────────────────────────────────────┐  │
│  │ currency → delta mapping (per lock)  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### Flash Accounting Flow

1. Caller invokes `poolManager.unlock(data)`
2. PoolManager calls `IUnlockCallback(msg.sender).unlockCallback(data)`
3. Inside the callback, caller executes operations (swap, modifyLiquidity, donate)
4. Each operation updates transient storage deltas — no token transfers yet
5. Caller resolves deltas via `settle()` (pay tokens in) and `take()` (withdraw tokens out)
6. On return from `unlockCallback`, PoolManager verifies all currency deltas are zero
7. If any delta is nonzero, the transaction reverts with `CurrencyNotSettled()`

This means multi-hop swaps (e.g., A→B→C) only require net token movements for A and C, saving gas on intermediate transfers.

### Functions Callable Outside unlock()

Only two functions do NOT require the unlock context:
- `initialize()` — creates a new pool (no balance changes)
- `updateDynamicLPFee()` — called by hook contracts to set the current dynamic fee

Everything else (`swap`, `modifyLiquidity`, `donate`, `take`, `settle`, `mint`, `burn`, `sync`, `clear`) requires being inside an active `unlockCallback`.

## Core Types

### PoolKey

The unique identifier for a pool. Defined in `v4-core/src/types/PoolKey.sol`:

```solidity
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

struct PoolKey {
    /// @notice The lower currency of the pool, sorted numerically
    Currency currency0;
    /// @notice The higher currency of the pool, sorted numerically
    Currency currency1;
    /// @notice The pool LP fee, capped at 1_000_000. If the highest bit is 1, the pool has a dynamic fee and must be exactly equal to 0x800000
    uint24 fee;
    /// @notice Ticks that involve positions must be a multiple of tick spacing
    int24 tickSpacing;
    /// @notice The hooks of the pool
    IHooks hooks;
}
```

**Sorting invariant**: `currency0 < currency1` is enforced. The PoolManager reverts with `CurrenciesOutOfOrderOrEqual` if violated. When constructing a PoolKey, always sort currencies by address value.

### PoolId

A `bytes32` hash of the PoolKey, used as the storage key for pool state. Defined in `v4-core/src/types/PoolId.sol`:

```solidity
type PoolId is bytes32;

library PoolIdLibrary {
    function toId(PoolKey memory poolKey) internal pure returns (PoolId poolId) {
        assembly ("memory-safe") {
            // 0xa0 = 5 slots × 32 bytes (total size of PoolKey struct)
            poolId := keccak256(poolKey, 0xa0)
        }
    }
}
```

Usage: `using PoolIdLibrary for PoolKey;` then `key.toId()`.

### Currency

An address wrapper where `address(0)` represents native ETH. Defined in `v4-core/src/types/Currency.sol`:

```solidity
type Currency is address;

library CurrencyLibrary {
    Currency public constant ADDRESS_ZERO = Currency.wrap(address(0));

    function isAddressZero(Currency currency) internal pure returns (bool) {
        return Currency.unwrap(currency) == Currency.unwrap(ADDRESS_ZERO);
    }

    function transfer(Currency currency, address to, uint256 amount) internal { /* handles ETH vs ERC-20 */ }
    function balanceOfSelf(Currency currency) internal view returns (uint256) { /* handles ETH vs ERC-20 */ }
}
```

Native ETH pools use `Currency.wrap(address(0))` as one of the currencies. No WETH wrapping required.

### BalanceDelta

Two `int128` values packed into a single `int256`. Upper 128 bits = amount0, lower 128 bits = amount1. Defined in `v4-core/src/types/BalanceDelta.sol`:

```solidity
type BalanceDelta is int256;

library BalanceDeltaLibrary {
    BalanceDelta public constant ZERO_DELTA = BalanceDelta.wrap(0);

    function amount0(BalanceDelta balanceDelta) internal pure returns (int128 _amount0) {
        assembly ("memory-safe") {
            _amount0 := sar(128, balanceDelta)
        }
    }

    function amount1(BalanceDelta balanceDelta) internal pure returns (int128 _amount1) {
        assembly ("memory-safe") {
            _amount1 := signextend(15, balanceDelta)
        }
    }
}
```

Delta semantics from the caller's perspective:
- **Negative** delta = caller owes tokens to PoolManager (must `settle()`)
- **Positive** delta = PoolManager owes tokens to caller (can `take()`)

### BeforeSwapDelta

Return type of the `beforeSwap` hook. Upper 128 bits = delta in **specified** tokens, lower 128 bits = delta in **unspecified** tokens. Defined in `v4-core/src/types/BeforeSwapDelta.sol`:

```solidity
type BeforeSwapDelta is int256;

function toBeforeSwapDelta(int128 deltaSpecified, int128 deltaUnspecified)
    pure
    returns (BeforeSwapDelta beforeSwapDelta)
{
    assembly ("memory-safe") {
        beforeSwapDelta := or(shl(128, deltaSpecified), and(sub(shl(128, 1), 1), deltaUnspecified))
    }
}

library BeforeSwapDeltaLibrary {
    BeforeSwapDelta public constant ZERO_DELTA = BeforeSwapDelta.wrap(0);
    function getSpecifiedDelta(BeforeSwapDelta delta) internal pure returns (int128);
    function getUnspecifiedDelta(BeforeSwapDelta delta) internal pure returns (int128);
}
```

## PoolManager Interface

Full interface from `v4-core/src/interfaces/IPoolManager.sol`. The PoolManager inherits `IProtocolFees`, `IERC6909Claims`, `IExtsload`, and `IExttload`.

### initialize

```solidity
function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
```

Creates a new pool. Does NOT require the unlock context. Reverts if `currency0 >= currency1`, if `tickSpacing` is zero or exceeds `type(int16).max`, or if the pool already exists. Emits `Initialize` event.

### unlock

```solidity
function unlock(bytes calldata data) external returns (bytes memory);
```

Entry point for all delta-accounting operations. Calls `IUnlockCallback(msg.sender).unlockCallback(data)`. After the callback returns, asserts all currency deltas are zero.

### swap

```solidity
function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
    external
    returns (BalanceDelta swapDelta);
```

Executes a swap. Only callable inside `unlockCallback`. Invokes `beforeSwap` and `afterSwap` hooks if the pool's hook contract has those permissions.

### modifyLiquidity

```solidity
function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
    external
    returns (BalanceDelta callerDelta, BalanceDelta feesAccrued);
```

Adds or removes liquidity. Returns both the principal delta and fees accrued. A zero `liquidityDelta` "pokes" the position to collect fees without changing liquidity.

### donate

```solidity
function donate(PoolKey memory key, uint256 amount0, uint256 amount1, bytes calldata hookData)
    external
    returns (BalanceDelta);
```

Distributes tokens to in-range liquidity providers. Useful for hook-driven fee distribution or protocol reward injection.

### Settlement Functions

```solidity
function settle() external payable returns (uint256 paid);
function settleFor(address recipient) external payable returns (uint256 paid);
function sync(Currency currency) external;
function take(Currency currency, address to, uint256 amount) external;
function clear(Currency currency, uint256 amount) external;
```

**settle()**: Pays what the caller owes. For ERC-20 tokens, the caller must first call `sync(currency)`, transfer tokens to the PoolManager, then call `settle()`. For native ETH, send value directly with `settle{value: amount}()`. Returns the amount credited.

**sync(currency)**: Snapshots the PoolManager's current ERC-20 balance into transient storage. MUST be called before transferring ERC-20 tokens for settlement. Not needed for native ETH.

**take(currency, to, amount)**: Withdraws tokens the PoolManager owes to the caller. Reverts if the caller's delta for that currency is insufficient.

**clear(currency, amount)**: Zeros out a positive delta WITHOUT transferring tokens. The tokens are permanently locked in the PoolManager. Use only for dust amounts.

### ERC-6909 Claims

```solidity
function mint(address to, uint256 id, uint256 amount) external;
function burn(address from, uint256 id, uint256 amount) external;
```

Converts currency deltas into ERC-6909 claim tokens (and vice versa). The `id` is the currency address cast to `uint256`. Useful for holding balances inside the PoolManager across transactions without actual token transfers.

## Parameter Structs

### SwapParams

Defined in `v4-core/src/types/PoolOperation.sol`:

```solidity
struct SwapParams {
    /// Whether to swap token0 for token1 or vice versa
    bool zeroForOne;
    /// The desired input amount if negative (exactIn), or the desired output amount if positive (exactOut)
    int256 amountSpecified;
    /// The sqrt price at which, if reached, the swap will stop executing
    uint160 sqrtPriceLimitX96;
}
```

**CRITICAL**: `amountSpecified` sign convention:
- **Negative** = exact input (caller specifies how much to spend)
- **Positive** = exact output (caller specifies how much to receive)

Price limits:
- `zeroForOne = true`: set `sqrtPriceLimitX96` to a value **less than** the current price (price decreases)
- `zeroForOne = false`: set `sqrtPriceLimitX96` to a value **greater than** the current price (price increases)
- Use `TickMath.MIN_SQRT_PRICE + 1` or `TickMath.MAX_SQRT_PRICE - 1` for unlimited slippage

### ModifyLiquidityParams

Defined in `v4-core/src/types/PoolOperation.sol`:

```solidity
struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}
```

- `liquidityDelta > 0`: add liquidity
- `liquidityDelta < 0`: remove liquidity
- `liquidityDelta == 0`: poke (collect accrued fees only)
- `salt`: differentiates multiple positions at the same tick range from the same address

## Fee System

### Static Fees

Set at pool creation via `PoolKey.fee`. Denominated in **hundredths of a basis point** (1/100th of 1/10000th):

| PoolKey.fee | Effective Fee |
|-------------|--------------|
| 100         | 0.01%        |
| 500         | 0.05%        |
| 3000        | 0.30%        |
| 10000       | 1.00%        |
| 1000000     | 100% (MAX)   |

### Dynamic Fees

From `v4-core/src/libraries/LPFeeLibrary.sol`:

```solidity
library LPFeeLibrary {
    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    uint24 public constant OVERRIDE_FEE_FLAG = 0x400000;
    uint24 public constant REMOVE_OVERRIDE_MASK = 0xBFFFFF;
    uint24 public constant MAX_LP_FEE = 1000000; // 100%
}
```

To create a dynamic fee pool, set `PoolKey.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG` (exactly `0x800000`).

Two mechanisms for dynamic fee updates:

1. **Persistent update**: Hook calls `poolManager.updateDynamicLPFee(key, newFee)` (e.g., in `afterInitialize` or periodically). This sets the stored fee for subsequent swaps.

2. **Per-swap override**: `beforeSwap` returns a fee with the override flag set in the third return value (`uint24`). The returned fee is `desiredFee | LPFeeLibrary.OVERRIDE_FEE_FLAG`. This overrides the stored fee for that single swap only.

```solidity
function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
    external
    override
    returns (bytes4, BeforeSwapDelta, uint24)
{
    uint24 dynamicFee = _computeFee();
    return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, dynamicFee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
}
```

### Protocol Fees

Set by the PoolManager owner via `IProtocolFees.setProtocolFee(PoolKey, uint24)`. Protocol fees are taken as a percentage of LP fees. The protocol fee is a `uint24` where the upper 12 bits are the fee for token0 and the lower 12 bits are the fee for token1.

## PositionManager (Periphery)

The `PositionManager` is the canonical periphery contract for managing liquidity positions as ERC-721 NFTs. Source: `v4-periphery/src/PositionManager.sol`.

```solidity
contract PositionManager is
    IPositionManager,
    ERC721Permit_v4,       // ERC-721 + EIP-4494 permit
    PoolInitializer_v4,
    Multicall_v4,
    DeltaResolver,
    ReentrancyLock,
    BaseActionsRouter,     // action dispatch via unlock
    Notifier,              // subscriber/notification pattern
    Permit2Forwarder,      // Permit2 integration
    NativeWrapper          // WETH wrapping/unwrapping
{ ... }
```

**NFT metadata**: Name = `"Uniswap v4 Positions NFT"`, Symbol = `"UNI-V4-POSM"`.

### Entry Point

```solidity
function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
```

The standard entry point. Encodes a sequence of actions and their parameters. The `unlockData` is ABI-encoded as `(bytes actions, bytes[] params)` where `actions` is a packed byte array of action codes.

### Action Codes

From `v4-periphery/src/libraries/Actions.sol`:

```solidity
library Actions {
    uint256 internal constant INCREASE_LIQUIDITY          = 0x00;
    uint256 internal constant DECREASE_LIQUIDITY          = 0x01;
    uint256 internal constant MINT_POSITION               = 0x02;
    uint256 internal constant BURN_POSITION               = 0x03;
    uint256 internal constant SWAP_EXACT_IN_SINGLE        = 0x06;
    uint256 internal constant SWAP_EXACT_IN               = 0x07;
    uint256 internal constant SWAP_EXACT_OUT_SINGLE       = 0x08;
    uint256 internal constant SWAP_EXACT_OUT              = 0x09;
    uint256 internal constant SETTLE                      = 0x0b;
    uint256 internal constant SETTLE_ALL                  = 0x0c;
    uint256 internal constant SETTLE_PAIR                 = 0x0d;
    uint256 internal constant TAKE                        = 0x0e;
    uint256 internal constant TAKE_ALL                    = 0x0f;
    uint256 internal constant TAKE_PORTION                = 0x10;
    uint256 internal constant TAKE_PAIR                   = 0x11;
    uint256 internal constant CLOSE_CURRENCY              = 0x12;
    uint256 internal constant CLEAR_OR_TAKE               = 0x13;
    uint256 internal constant SWEEP                       = 0x14;
    uint256 internal constant WRAP                        = 0x15;
    uint256 internal constant UNWRAP                      = 0x16;
}
```

**DEPRECATED** (vulnerable to sandwich attacks — lack slippage protection):
- `INCREASE_LIQUIDITY_FROM_DELTAS` (0x04)
- `MINT_POSITION_FROM_DELTAS` (0x05)

### Typical Action Sequences

Mint a new position:
```
[MINT_POSITION, SETTLE_PAIR, SWEEP]  // or CLOSE_CURRENCY for each
```

Increase liquidity on existing position:
```
[INCREASE_LIQUIDITY, SETTLE_PAIR, SWEEP]
```

Decrease liquidity and collect:
```
[DECREASE_LIQUIDITY, TAKE_PAIR]
```

Burn an empty position:
```
[BURN_POSITION]  // position must have zero liquidity
```

### Subscriber/Notification Pattern

The `Notifier` base enables position subscribers — external contracts that receive callbacks when a position is modified. Subscribers implement `ISubscriber`:

```solidity
interface ISubscriber {
    function notifySubscribe(uint256 tokenId, bytes memory data) external;
    function notifyUnsubscribe(uint256 tokenId) external;
    function notifyModifyLiquidity(uint256 tokenId, int256 liquidityChange, BalanceDelta feesAccrued) external;
    function notifyBurn(uint256 tokenId) external;
}
```

Subscribe via `positionManager.subscribe(tokenId, subscriber, data)`. The subscriber is notified on every liquidity modification or burn.

## Production Deployment Addresses

### Ethereum Mainnet (Chain ID: 1)

| Contract | Address |
|----------|---------|
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| Universal Router | `0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af` |
| PositionManager | `0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e` |

### Supported Chains

V4 is deployed on: **Ethereum, Unichain, Optimism, Base, Arbitrum One, Polygon, Blast, Zora, Worldchain, Ink, Soneium, Avalanche, BNB Smart Chain, Celo, Monad, MegaETH, Tempo**

**CRITICAL**: Addresses are NOT the same across chains. Always verify per-chain at https://docs.uniswap.org/contracts/v4/deployments. Use `cast code <address> --rpc-url <rpc>` to confirm deployment before integrating.

## Integration Patterns

### Custom Router (unlockCallback)

A minimal router that performs a swap by implementing `IUnlockCallback`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";

contract SimpleSwapRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function swap(PoolKey calldata key, SwapParams calldata params) external payable {
        poolManager.unlock(abi.encode(key, params, msg.sender));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert();

        (PoolKey memory key, SwapParams memory params, address sender) =
            abi.decode(data, (PoolKey, SwapParams, address));

        BalanceDelta delta = poolManager.swap(key, params, "");

        _settleDelta(sender, key.currency0, delta.amount0());
        _settleDelta(sender, key.currency1, delta.amount1());

        return "";
    }

    function _settleDelta(address sender, Currency currency, int128 delta) internal {
        if (delta < 0) {
            // Caller owes tokens to PoolManager
            uint256 amount = uint256(uint128(-delta));
            if (currency.isAddressZero()) {
                poolManager.settle{value: amount}();
            } else {
                poolManager.sync(currency);
                IERC20Minimal(Currency.unwrap(currency)).transferFrom(sender, address(poolManager), amount);
                poolManager.settle();
            }
        } else if (delta > 0) {
            // PoolManager owes tokens to caller
            poolManager.take(currency, sender, uint256(uint128(delta)));
        }
    }
}
```

### Settle/Take Pattern Summary

```
ERC-20 settlement:
  1. poolManager.sync(currency)           — snapshot current balance
  2. token.transferFrom(user, poolManager) — transfer tokens in
  3. poolManager.settle()                  — credit the delta

Native ETH settlement:
  1. poolManager.settle{value: amount}()   — send ETH directly

Withdrawal:
  1. poolManager.take(currency, recipient, amount)
```

### ERC-6909 Claim Token Pattern

For protocols that hold persistent balances in the PoolManager (avoiding repeated transfers):

```solidity
// Convert positive delta to ERC-6909 claim tokens (keep balance in PM)
poolManager.mint(address(this), currency.toId(), amount);

// Later, burn claim tokens to create a negative delta (as if depositing)
poolManager.burn(address(this), currency.toId(), amount);
```

## Foundry Setup

### Installation

```bash
forge install uniswap/v4-core
forge install uniswap/v4-periphery
```

### Remappings (foundry.toml or remappings.txt)

```toml
[profile.default]
remappings = [
    "v4-core/=lib/v4-core/",
    "v4-periphery/=lib/v4-periphery/",
    "@uniswap/v4-core/=lib/v4-core/",
    "@uniswap/v4-periphery/=lib/v4-periphery/",
    "permit2/=lib/v4-periphery/lib/permit2/",
    "forge-std/=lib/forge-std/src/",
]
```

### Import Paths

```solidity
// Core types
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

// Core interfaces
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";

// Libraries
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";

// Periphery — hooks
import {BaseHook} from "v4-periphery/src/base/hooks/BaseHook.sol";

// Periphery — position management
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
```

### Test Harness

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract MyV4Test is Test, Deployers {
    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        (key,) = initPool(
            currency0,
            currency1,
            IHooks(address(0)),  // no hook
            3000,                // 0.30% fee
            SQRT_PRICE_1_1       // 1:1 starting price
        );
    }
}
```

The `Deployers` helper from `v4-core/test/utils/Deployers.sol` provides `deployFreshManagerAndRouters()`, `deployMintAndApprove2Currencies()`, `initPool()`, and test routers (`swapRouter`, `modifyLiquidityRouter`).

## Key Differences from V3

| Aspect | Uniswap V3 | Uniswap V4 |
|--------|-----------|-----------|
| Architecture | Factory + individual pool contracts | Singleton PoolManager |
| Pool identification | Contract address | `PoolKey` → `PoolId` (bytes32 hash) |
| Token transfers | Direct transfers on every operation | Flash accounting (deltas in transient storage) |
| Multi-hop efficiency | Transfer tokens between each pool | Net settlement — only endpoints transfer |
| Native ETH | Must wrap to WETH first | Native ETH via `Currency.wrap(address(0))` |
| Extensibility | No hook system | 14 hook callbacks with return-delta support |
| Fee model | Fixed fee tiers (0.01%, 0.05%, 0.30%, 1%) | Arbitrary static fees + dynamic fees via hooks |
| Fee distribution | Swap fees only | `donate()` for direct distribution to LPs |
| Position NFTs | NonfungiblePositionManager (V3) | PositionManager with Permit2 + ERC-6909 |
| LP fee updates | Immutable after pool creation | Dynamic via `updateDynamicLPFee()` |
| Transient storage | Not used (pre-Cancun) | EIP-1153 for delta tracking |
| Flash loans | Dedicated `flash()` function | Implicit via unlock — take first, settle later |
| Custom accounting | Not possible | Hooks can modify swap amounts via return deltas |
| Solidity version | 0.7.6 | 0.8.26 |

### Flash Loans in V4

V4 has no dedicated flash loan function. Flash loans are implicit: inside `unlockCallback`, call `take()` to receive tokens, use them, then `settle()` to repay. As long as all deltas net to zero before the callback returns, the transaction succeeds. Effectively zero-fee flash loans.

```solidity
function unlockCallback(bytes calldata) external returns (bytes memory) {
    // Borrow 1000 USDC
    poolManager.take(usdc, address(this), 1000e6);

    // ... use the USDC (arbitrage, liquidation, etc.) ...

    // Repay 1000 USDC
    poolManager.sync(usdc);
    IERC20(Currency.unwrap(usdc)).transfer(address(poolManager), 1000e6);
    poolManager.settle();

    return "";
}
```

## Hook System Reference

### Permission Flags

Hook addresses encode permissions in the leading bits of the address. The PoolManager validates these at pool initialization.

```solidity
struct Permissions {
    bool beforeInitialize;
    bool afterInitialize;
    bool beforeAddLiquidity;
    bool afterAddLiquidity;
    bool beforeRemoveLiquidity;
    bool afterRemoveLiquidity;
    bool beforeSwap;
    bool afterSwap;
    bool beforeDonate;
    bool afterDonate;
    bool beforeSwapReturnDelta;
    bool afterSwapReturnDelta;
    bool afterAddLiquidityReturnDelta;
    bool afterRemoveLiquidityReturnDelta;
}
```

### Hook Callback Signatures

```solidity
function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
    external returns (bytes4);

function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
    external returns (bytes4);

function beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
    external returns (bytes4);

function afterAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, BalanceDelta delta, BalanceDelta feesAccrued, bytes calldata hookData)
    external returns (bytes4, BalanceDelta);

function beforeRemoveLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
    external returns (bytes4);

function afterRemoveLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, BalanceDelta delta, BalanceDelta feesAccrued, bytes calldata hookData)
    external returns (bytes4, BalanceDelta);

function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
    external returns (bytes4, BeforeSwapDelta, uint24);

function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
    external returns (bytes4, int128);

function beforeDonate(address sender, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
    external returns (bytes4);

function afterDonate(address sender, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
    external returns (bytes4);
```

### Return Delta Hooks

When a hook has `beforeSwapReturnDelta` permission, the `BeforeSwapDelta` it returns modifies the swap:
- `deltaSpecified` (upper 128 bits): adjusts the specified token amount
- `deltaUnspecified` (lower 128 bits): adjusts the unspecified token amount

When a hook has `afterSwapReturnDelta` permission, the `int128` returned from `afterSwap` modifies the unspecified token delta.

## Common Pitfalls

1. **Forgetting sync() before ERC-20 settlement**: The PoolManager calculates payment by diffing its balance before and after. Without `sync()`, the diff is wrong.

2. **amountSpecified sign confusion**: Negative = exact input, positive = exact output. This is the reverse of what many developers expect.

3. **Currency sorting**: `currency0 < currency1` is mandatory. Sort by address value before constructing `PoolKey`.

4. **sqrtPriceLimitX96 direction**: For `zeroForOne = true`, the limit must be BELOW current price. For `zeroForOne = false`, ABOVE. Using the wrong direction causes silent no-ops or reverts.

5. **Hook address mismatch**: Hook permission bits are encoded in the address itself. A hook deployed to the wrong address will fail validation at pool initialization.

6. **Unchecked delta resolution**: Every positive and negative delta MUST be resolved before `unlockCallback` returns. Partial resolution causes `CurrencyNotSettled()` revert.

7. **Reentrancy through unlock**: `unlock()` cannot be called while already unlocked (`AlreadyUnlocked()` error). Hooks cannot re-enter the PoolManager via a second `unlock()`.

8. **Fee precision**: Fees are in hundredths of a bip (1e-6), NOT basis points. 3000 = 0.30%, not 30%.

9. **Dynamic fee flag**: A dynamic fee pool MUST set `PoolKey.fee` to exactly `0x800000`. Any other value with the high bit set is invalid.

10. **BalanceDelta packing**: Don't cast `BalanceDelta` directly to `int256` and interpret as a single number. Use `.amount0()` and `.amount1()` accessors.

## Checklist

### Pool Integration

- [ ] PoolKey currencies are sorted (`currency0 < currency1`)
- [ ] PoolKey fee is valid: either a static fee `<= 1_000_000` or exactly `DYNAMIC_FEE_FLAG`
- [ ] `tickSpacing > 0` and `<= type(int16).max`
- [ ] Pool is initialized before any swaps or liquidity operations
- [ ] All operations (except `initialize`) are inside an `unlockCallback`
- [ ] `unlockCallback` validates `msg.sender == address(poolManager)`

### Delta Resolution

- [ ] Every currency delta is resolved to zero before callback returns
- [ ] `sync(currency)` called before every ERC-20 transfer into PoolManager
- [ ] Native ETH settled via `settle{value: amount}()` (not sync + transfer)
- [ ] Positive deltas resolved via `take()`, not left dangling
- [ ] Consider `clear()` only for known-dust amounts (tokens are PERMANENTLY locked)

### Swap Integration

- [ ] `amountSpecified` sign is correct: negative = exact input, positive = exact output
- [ ] `sqrtPriceLimitX96` direction matches `zeroForOne` flag
- [ ] For unlimited slippage: `zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1`
- [ ] Hook return deltas are accounted for in final settlement
- [ ] Swap delta checked for expected bounds (slippage protection)

### Hook Development

- [ ] Hook address bits match `getHookPermissions()` return value
- [ ] All hook callbacks return the correct function selector
- [ ] `beforeSwap` fee override includes `LPFeeLibrary.OVERRIDE_FEE_FLAG`
- [ ] Dynamic fee values are `<= LPFeeLibrary.MAX_LP_FEE` (1_000_000)
- [ ] Hook state is keyed by `PoolId` (not raw PoolKey) for gas efficiency
- [ ] No reentrancy through `unlock()` from within hook callbacks
- [ ] Hook tested with exact-input AND exact-output swaps
- [ ] Gas overhead of hook callbacks measured and documented

### PositionManager Usage

- [ ] Permit2 allowances set for tokens before interacting with PositionManager
- [ ] Action sequences end with settlement actions (`SETTLE_PAIR`, `TAKE_PAIR`, etc.)
- [ ] `SWEEP` used to return excess tokens to the caller
- [ ] Deadline parameter set to prevent stale transactions
- [ ] Position tokenId tracked for future modifications
- [ ] Never use deprecated `MINT_POSITION_FROM_DELTAS` or `INCREASE_LIQUIDITY_FROM_DELTAS`

### Security

- [ ] Custom router validates `msg.sender == address(poolManager)` in `unlockCallback`
- [ ] Token approvals are scoped (no unlimited approvals to untrusted contracts)
- [ ] Slippage protection on all user-facing swap and liquidity functions
- [ ] Deployment addresses verified per-chain (NOT assumed to be cross-chain identical)
- [ ] `hookData` from untrusted callers is validated or bounded in size
- [ ] ERC-6909 claim token balances accounted for in protocol security model
