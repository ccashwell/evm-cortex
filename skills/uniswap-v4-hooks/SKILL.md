---
name: uniswap-v4-hooks
description: Use when building or reviewing Uniswap V4 hooks, custom AMM logic, dynamic fees, access controls, oracle hooks, return deltas, hook deployment, or hook-specific tests. Covers the current 14 permission flags, 10 callbacks, BaseHook implementation, delta accounting, address mining, and testing requirements.
---

# Uniswap V4 Hook Development

Build against one pinned, compatible dependency graph. Start from a pinned
revision of the Uniswap V4 template or pin `v4-core`, `v4-periphery`, and the
hook library to known-compatible revisions. Do not combine examples from
different releases.

Before editing, inspect the project's `foundry.lock`, `.gitmodules`, and
remappings. Read `Hooks.sol`, `IHooks.sol`, `PoolOperation.sol`, `BaseHook.sol`,
and `HookMiner.sol` at those installed revisions. The links at the end are for
discovery; the project's pinned dependency graph is the source of truth.

## Architecture

Uniswap V4 keeps pools in a singleton `PoolManager`. A `PoolKey` selects one
hook contract or no hook. The same hook contract can serve multiple pools.

The least significant 14 bits of the hook address encode callback permissions.
`PoolManager.initialize` rejects an invalid hook address, and a maintained
`BaseHook` validates the deployed address against `getHookPermissions()` in its
constructor. Deploy a production hook with `CREATE2` and a salt mined for the
required low-bit pattern.

In a callback:

- `msg.sender` is `PoolManager`.
- The callback's `sender` argument is the immediate caller of the PoolManager
  operation. It is commonly a router, not the end user.
- `hookData` is caller-controlled unless a trusted integration authenticates
  and binds it to the operation.

An authentic PoolManager callback does not prove that the pool is authorized.
Anyone can attempt to initialize a `PoolKey` that names the hook. A hook must
either support permissionless pool creation or validate the complete intended
`PoolKey` or `PoolId`. Initialization-sensitive hooks must also validate the
initial price and every other required pool parameter.

## Permission Flags

The constants below are defined by `v4-core/src/libraries/Hooks.sol`.

| Bit | Permission | Callback effect |
| ---: | --- | --- |
| 13 | `BEFORE_INITIALIZE_FLAG` | Calls `beforeInitialize` |
| 12 | `AFTER_INITIALIZE_FLAG` | Calls `afterInitialize` |
| 11 | `BEFORE_ADD_LIQUIDITY_FLAG` | Calls `beforeAddLiquidity` |
| 10 | `AFTER_ADD_LIQUIDITY_FLAG` | Calls `afterAddLiquidity` |
| 9 | `BEFORE_REMOVE_LIQUIDITY_FLAG` | Calls `beforeRemoveLiquidity` |
| 8 | `AFTER_REMOVE_LIQUIDITY_FLAG` | Calls `afterRemoveLiquidity` |
| 7 | `BEFORE_SWAP_FLAG` | Calls `beforeSwap` |
| 6 | `AFTER_SWAP_FLAG` | Calls `afterSwap` |
| 5 | `BEFORE_DONATE_FLAG` | Calls `beforeDonate` |
| 4 | `AFTER_DONATE_FLAG` | Calls `afterDonate` |
| 3 | `BEFORE_SWAP_RETURNS_DELTA_FLAG` | Applies the `BeforeSwapDelta` returned by `beforeSwap` |
| 2 | `AFTER_SWAP_RETURNS_DELTA_FLAG` | Applies the `int128` returned by `afterSwap` |
| 1 | `AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG` | Applies the `BalanceDelta` returned by `afterAddLiquidity` |
| 0 | `AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG` | Applies the `BalanceDelta` returned by `afterRemoveLiquidity` |

The four return-delta flags do not enable callbacks by themselves. Each one
requires its corresponding callback flag.

```solidity
uint160 flags = Hooks.BEFORE_SWAP_FLAG
    | Hooks.AFTER_SWAP_FLAG
    | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
```

## Callback Interface

Import `ModifyLiquidityParams` and `SwapParams` from
`v4-core/src/types/PoolOperation.sol`. They are top-level types, not members of
`IPoolManager`.

| Callback | Parameters after `sender, key` | Return value |
| --- | --- | --- |
| `beforeInitialize` | `uint160 sqrtPriceX96` | `bytes4` |
| `afterInitialize` | `uint160 sqrtPriceX96, int24 tick` | `bytes4` |
| `beforeAddLiquidity` | `ModifyLiquidityParams params, bytes hookData` | `bytes4` |
| `afterAddLiquidity` | `ModifyLiquidityParams params, BalanceDelta delta, BalanceDelta feesAccrued, bytes hookData` | `(bytes4, BalanceDelta)` |
| `beforeRemoveLiquidity` | `ModifyLiquidityParams params, bytes hookData` | `bytes4` |
| `afterRemoveLiquidity` | `ModifyLiquidityParams params, BalanceDelta delta, BalanceDelta feesAccrued, bytes hookData` | `(bytes4, BalanceDelta)` |
| `beforeSwap` | `SwapParams params, bytes hookData` | `(bytes4, BeforeSwapDelta, uint24)` |
| `afterSwap` | `SwapParams params, BalanceDelta delta, bytes hookData` | `(bytes4, int128)` |
| `beforeDonate` | `uint256 amount0, uint256 amount1, bytes hookData` | `bytes4` |
| `afterDonate` | `uint256 amount0, uint256 amount1, bytes hookData` | `bytes4` |

For liquidity callbacks, `liquidityDelta > 0` selects the add path and
`liquidityDelta <= 0` selects the remove path. A zero-liquidity modification
can therefore invoke remove callbacks to collect fees without withdrawing
principal.

Every callback must return its external callback selector. Non-delta callback
responses must contain at least the 32-byte selector word. `beforeSwap` must
return exactly 96 bytes. When an after-callback return delta is enabled, its
response must be exactly 64 bytes.

## BaseHook Pattern

When the project's pinned dependency graph uses OpenZeppelin's hook library,
override the internal `_before*` and `_after*` functions of its `BaseHook`. The
inherited external entry points already enforce `onlyPoolManager`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract MyHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    mapping(PoolId poolId => uint256 count) public swapCount;

    constructor(IPoolManager manager) BaseHook(manager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
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

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        swapCount[key.toId()]++;
        return (BaseHook.afterSwap.selector, 0);
    }
}
```

Keep these three things in exact agreement:

1. The callbacks implemented by the contract.
2. The booleans returned by `getHookPermissions()`.
3. The low-bit flags used to mine the deployed address.

## Dynamic LP Fees

A `beforeSwap` callback can override the LP fee only when the pool's `PoolKey`
uses `LPFeeLibrary.DYNAMIC_FEE_FLAG`. Return the desired fee combined with
`LPFeeLibrary.OVERRIDE_FEE_FLAG`. The fee component must be at most
`LPFeeLibrary.MAX_LP_FEE`, where `1_000_000` represents 100%. A total swap fee
of 100% is valid only for exact input when the post-hook native-pool amount is
nonzero. Exact output at that boundary reverts while its post-hook native-pool
amount remains positive. If a specified return delta reduces that amount
exactly to zero, core skips the native curve and the hook must deliver and
settle the complete exchange. A dynamic-fee policy that uses the native curve
for exact output must remain below the boundary after protocol and LP fees are
combined. Returning a value without a valid override flag leaves the pool's
current dynamic fee in effect.

Bound every input used to calculate a fee. Test the zero fee, maximum fee, and
both exact-input and exact-output paths.

## Access Control

Do not treat the callback `sender` as the end user. For standard router flows it
identifies the router. An allowlist on `sender` is therefore a router allowlist,
not a user allowlist.

If the hook needs end-user authorization, use a router that enforces the
authorization and passes authenticated context, or verify authorization
carried in `hookData`. Bind that authorization to the chain, hook, pool,
operation, payer, recipient, economic limits, nonce, and deadline. Trusting a
router address or decoded user address alone does not authenticate its caller.

## Oracle and TWAP Hooks

The current pool tick can be manipulated within a transaction. A production
TWAP needs a complete observation design: bounded storage, correct cumulative
tick growth between writes, interpolation, wraparound handling, and defined
behavior when history is insufficient.

Do not ship an `afterSwap` array append plus an unfinished `consult` function.
Use a tested observation implementation compatible with the project's pinned
dependency graph, or test the complete implementation as a separate accounting
system.

For external price sources, verify units, decimals, freshness, observation
windows, manipulation resistance, invalid-value behavior, and sequencer or
cross-chain liveness when applicable. Test stale, reverted, delayed, and
out-of-order updates.

## Return Deltas and Custom Accounting

Return deltas are denominated from the hook's perspective:

- Positive means the hook is owed or takes currency.
- Negative means the hook owes or sends currency.
- `BeforeSwapDelta` contains specified and unspecified currency amounts. These
  are not fixed to currency0 and currency1.
- `afterSwap` returns only the hook delta for the unspecified currency.
- Liquidity return deltas contain currency0 and currency1 amounts.

For both `afterAddLiquidity` and `afterRemoveLiquidity`, including
zero-liquidity fee collection, trace principal, `feesAccrued`, the returned hook
delta, the resulting caller delta, hook inventory, and settlement in both
currencies. Core subtracts the returned hook delta from the caller's aggregate
delta and accounts it to the hook.

For a swap, the specified currency depends on both `zeroForOne` and whether
`amountSpecified` is exact input (negative) or exact output (positive). A
nonzero specified delta may reduce the amount executed by the native pool, but
it cannot cross zero and change the swap from exact input to exact output or
the reverse. Reaching exactly zero is allowed. At that boundary the native swap
is skipped and the hook acts as the complete exchange, so it must provide and
settle the output while enforcing pricing and slippage.

Returning a delta changes PoolManager accounting; it does not transfer tokens
or prove that output inventory exists. Every address/currency delta opened
during the unlock must be zero before the unlock returns. For ERC-20 payment,
call `sync(currency)`, transfer the tokens, then call `settle()` or
`settleFor()`. For native payment, sync the native currency before calling
`settle{value: amount}()` or `settleFor{value: amount}()` by first calling
`poolManager.sync(Currency.wrap(address(0)))`; this prevents a stale ERC-20 sync
from misclassifying settlement. Use `take` and claims deliberately.

Trace `clear` and direct transfers or donations before settlement. Do not use
an absolute token balance as proof of per-pool reserves or settlement.

Do not model a replacement curve as two return values alone. Use a maintained
custom-accounting or custom-curve base, then prove pricing, inventory,
settlement, slippage, rounding, and solvency for every path.

## Complex Hook Architectures

The following designs are protocols, not single-callback snippets:

- **TWAMM**: Bound virtual-order work per call, define keeper progress and
  cancellation, execute swaps within the active unlock, and settle every
  resulting delta.
- **Limit orders**: Track ownership and partial fills, process tick crossings
  with bounded work, and define cancellation and claim behavior.
- **Auto-compounding**: Track the hook's actual positions and fee ownership,
  settle liquidity modifications, enforce user share accounting, and bound
  compounding work.

Start from a maintained implementation when possible. Do not invent helpers
such as `_getAccruedFees`, `_fillCrossedOrders`, or `_reinvestFees` without
defining their accounting and settlement behavior.

## Address Mining and Deployment

Use the `HookMiner` that belongs to the dependency set pinned by the project.
Follow the production deployment flow documented by that pinned `HookMiner`
revision:

1. Combine the required `Hooks.*_FLAG` constants.
2. Encode the exact constructor arguments.
3. Mine using the address that will execute `CREATE2`.
4. Deploy with the returned salt.
5. Require that the deployed address equals the predicted address.

In a Foundry script using the deterministic deployment proxy, mine with the
proxy address used by the script. In a test using `new Hook{salt: salt}`, mine
with the address of the contract that actually executes `CREATE2`, normally
`address(this)`. Do not substitute a callback caller or a pranked `msg.sender`
without confirming the creator used by the deployment path.

`Hooks.validateHookPermissions` returns nothing and reverts on a mismatch. It
cannot be used as a boolean condition in a mining loop. If implementing a miner
instead of using the maintained library, compare
`uint160(predicted) & Hooks.ALL_HOOK_MASK` with the desired flags and test the
full init-code and deployer calculation.

## Hook-Specific Test Requirements

Use test helpers from the same dependency graph pinned by the project. When
starting a new project, use a pinned revision of the Uniswap V4 template. Do not
copy `Deployers` or `HookMiner` snippets from another revision. In tests, either
mine and deploy with the actual deployer or use `deployCodeTo` at an address
with the exact permission bits.

Test behavior, not only callback counters:

- Every enabled and disabled callback.
- Exact-input and exact-output swaps in both directions.
- Zero, boundary, and maximum valid amounts and fees.
- Multiple pools sharing one hook.
- Return-delta settlement for each currency and native currency.
- Invalid selectors, flag mismatches, malformed `hookData`, and unauthorized
  routers.
- Direct PoolManager and attacker-controlled unlock paths, including `donate`,
  fee-only collection, repeated initialization, and partial or full removal.
- Hostile pools with attacker-selected counterpart currencies that place a
  supported or protocol-issued token in either canonical currency slot, plus
  alternate fees or tick spacing; test every supported nonstandard token
  behavior.
- For time-dependent fees or penalties, sequences involving fee updates,
  minimal adds, fee-only collection, donations, direction changes, and multiple
  swaps in one transaction.
- For range, vault, or custom-curve hooks, mixed decimals and fixed-point
  scales, cast and rounding bounds, boundary ticks, empty ranges, first
  deposits, and repeated minimum withdrawals.
- Malformed or selectively reverting dependencies during swaps, liquidity
  changes, and user exits.
- Bounded gas as state and order counts grow.
- Fork behavior against the intended deployed PoolManager.

## Security Rules

- Report a security finding only when a reachable attacker path produces a
  concrete effect on value, authorization, accounting, solvency, pricing, or
  liveness. Record design assumptions separately.
- Trace every privileged path that can change the implementation, trusted
  routers, accepted pools, pricing dependencies, fees, or exit behavior. For an
  upgrade, verify storage layout, callback ABI, and address permission bits
  against the deployed configuration.
- Use the external callback guards supplied by a maintained `BaseHook`. If
  implementing `IHooks` directly, reject every callback caller except the
  configured PoolManager.
- If implementing `IUnlockCallback`, reject every `unlockCallback` caller except
  the configured PoolManager before decoding or trusting callback data.
- Key state by its complete economic domain. Include `PoolId` and any owner,
  operator, ticks, position salt, market, vault, epoch, or order identity that
  distinguishes assets or liabilities. Global state is valid only when
  intentionally shared across every pool served by the hook.
- Treat callback-time external calls as reentrancy and denial-of-service
  surfaces. Validate return data and test selective reverts and token or
  receiver callbacks. Do not start a new `unlock` from an active callback. A
  hook can call unlocked PoolManager operations directly, but core suppresses
  that hook's callbacks when the hook is the immediate caller. An external
  callee that invokes PoolManager can trigger the callbacks again. Test both
  nested paths, and do not let an optional integration block a safe exit.
- Measure gas on realistic and adversarial state sizes. There is no universal
  50,000-gas safety threshold.
- Treat spot prices and same-transaction state as manipulable.
- Conserve value and settle every per-address/per-currency delta on each
  non-reverting unlock path. Reverting paths must unwind atomically.

## Checklist

- [ ] Core, periphery, hook library, and template revisions are compatible and pinned
- [ ] `getHookPermissions()` matches the least significant 14 address bits
- [ ] Each return-delta flag has its parent callback flag
- [ ] Internal BaseHook overrides return the correct external selector
- [ ] Direct `IHooks` implementations restrict callbacks to PoolManager
- [ ] The hook supports permissionless pools or validates its complete pool domain
- [ ] Router identity is not confused with end-user identity
- [ ] State is keyed by its complete economic domain, including `PoolId` where pool-specific
- [ ] Dynamic fees are enabled on the pool and bounded to `MAX_LP_FEE`
- [ ] Return-delta signs are correct for exact input/output and both directions
- [ ] Zero-liquidity removal callbacks and zero native-swap amounts are tested
- [ ] Every per-address/per-currency delta is settled on each non-reverting unlock path
- [ ] External calls and loops cannot create unbounded callback gas
- [ ] Native currency and nonstandard-token assumptions are tested
- [ ] `hookData` is treated as untrusted unless authenticated
- [ ] Production mining uses the real CREATE2 deployer and exact init code
- [ ] Tests cover multiple pools, boundary amounts, malformed input, and failure paths
