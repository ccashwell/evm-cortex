# Solidity Style Guide

Opinionated style guide aligned with Uniswap's smart contract conventions (v4-core, v4-periphery).

## Pragma & License

Fixed pragma, never floating. Pin to the exact compiler version you test against:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
```

Never use `^0.8.x` in production contracts. Floating pragmas introduce untested compiler behavior.

## Imports

Named imports only, grouped by category. Never wildcard import.

```solidity
// Libraries
import {Hooks} from "./libraries/Hooks.sol";
import {Pool} from "./libraries/Pool.sol";
import {SafeCast} from "./libraries/SafeCast.sol";

// Types
import {Currency} from "./types/Currency.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {BalanceDelta} from "./types/BalanceDelta.sol";

// Interfaces
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {IHooks} from "./interfaces/IHooks.sol";

// Contracts
import {ERC6909Claims} from "./ERC6909Claims.sol";
```

## Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Contracts | PascalCase | `PoolManager`, `TokenVault` |
| Interfaces | `I` prefix | `IPoolManager`, `IHooks` |
| Libraries | PascalCase | `SafeCast`, `TickMath`, `LPFeeLibrary` |
| Custom types | PascalCase | `Currency`, `PoolId`, `BalanceDelta` |
| Functions | camelCase | `modifyLiquidity`, `settleFor` |
| Internal/private state | `_` prefix | `_pools`, `_totalSupply` |
| Public state | no prefix | `protocolFees` |
| Constants | UPPER_SNAKE or PascalCase | `MAX_TICK_SPACING`, `ZERO_DELTA` |
| Immutables | camelCase | `poolManager`, `positionManager` |
| Events | PascalCase verb | `Swap`, `Initialize`, `ModifyLiquidity` |
| Errors | PascalCase descriptive | `ManagerLocked`, `CurrencyNotSettled` |
| Modifiers | camelCase | `onlyWhenUnlocked`, `noDelegateCall` |
| Function params | camelCase | `sqrtPriceX96`, `hookData` |
| Local variables | camelCase | `callerDelta`, `amountToProtocol` |

## File Layout

```
1. SPDX license
2. Pragma (fixed version)
3. Imports (libraries → types → interfaces → contracts)
4. Contract declaration
```

## Contract Internal Layout

```
1. using declarations
2. Constants
3. Immutables
4. State variables (mappings, then scalars)
5. Events (if not in interface)
6. Errors (if not in interface)
7. Modifiers
8. Constructor
9. External functions
10. Public functions
11. Internal functions (prefixed _)
12. Private functions (prefixed _)
13. View/pure helpers
```

## `using` Declarations

Declare at contract level, use `for *` when the library is used pervasively:

```solidity
using SafeCast for *;
using Pool for *;
using Hooks for IHooks;
using CurrencyDelta for Currency;
using LPFeeLibrary for uint24;
```

## Error Handling

Use custom errors with the `selector.revertWith()` pattern. Never use `require` strings.

```solidity
// Uniswap style — compact, saves gas, uses CustomRevert library
if (key.tickSpacing > MAX_TICK_SPACING) TickSpacingTooLarge.selector.revertWith(key.tickSpacing);
if (!Lock.isUnlocked()) ManagerLocked.selector.revertWith();

// Also acceptable — standard revert
if (amount == 0) revert SwapAmountCannotBeZero();

// Never — wastes gas on string storage
require(amount > 0, "Amount must be positive");
```

Single-line `if (...) revert` for simple guards. No braces needed for one-liners.

## Error Design

Errors should be descriptive nouns/states, not sentences. Include relevant parameters:

```solidity
error TickSpacingTooLarge(int24 tickSpacing);
error TickSpacingTooSmall(int24 tickSpacing);
error CurrenciesOutOfOrderOrEqual(address currency0, address currency1);
error ManagerLocked();
error CurrencyNotSettled();
error MustClearExactPositiveDelta();
```

## Function Signatures

Short signatures on one line. Long signatures: params indented, returns on the next line:

```solidity
// Short — one line
function settle() external payable onlyWhenUnlocked returns (uint256) {

// Long — multi-line with returns
function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
    external
    onlyWhenUnlocked
    noDelegateCall
    returns (BalanceDelta callerDelta, BalanceDelta feesAccrued)
{
```

Visibility comes first, then modifiers, then returns.

## Named Mapping Parameters

Always use named parameters in mappings for readability:

```solidity
mapping(PoolId id => Pool.State) internal _pools;
mapping(address owner => mapping(address spender => uint256 amount)) internal _allowance;
```

## Struct Construction

Use named fields, never positional:

```solidity
// Good — explicit field names
pool.modifyLiquidity(Pool.ModifyLiquidityParams({
    owner: msg.sender,
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
    liquidityDelta: params.liquidityDelta.toInt128(),
    tickSpacing: key.tickSpacing,
    salt: params.salt
}));

// Bad — positional arguments
pool.modifyLiquidity(Pool.ModifyLiquidityParams(
    msg.sender, params.tickLower, params.tickUpper, ...
));
```

## Unchecked Blocks

Use `unchecked` only where overflow is provably impossible. Always comment why:

```solidity
unchecked {
    // negation must be safe as amount is not negative
    _accountDelta(currency, -(amount.toInt128()), msg.sender);
}
```

## Comments

Explain *why*, never *what*. The code should be self-documenting.

```solidity
// Good — explains non-obvious reasoning
// event is emitted before the afterSwap call to ensure events are always emitted in order

// Good — documents safety invariant
// negation must be safe as amountDelta is positive

// Bad — narrates obvious code
// transfer tokens to the user
// increment the counter
```

## NatSpec

Use `@inheritdoc` for interface implementations. Full NatSpec on interfaces, not implementations:

```solidity
// In the interface (full NatSpec):
/// @notice Swaps currency along the price curve
/// @param key The pool to swap in
/// @param params The swap parameters
/// @param hookData Arbitrary data passed to hooks
/// @return swapDelta The balance delta of the swap
function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
    external
    returns (BalanceDelta swapDelta);

// In the implementation (inherit):
/// @inheritdoc IPoolManager
function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
    external
    onlyWhenUnlocked
    noDelegateCall
    returns (BalanceDelta swapDelta)
{
```

Internal functions get `/// @notice`:

```solidity
/// @notice Adds a balance delta in a currency for a target address
function _accountDelta(Currency currency, int128 delta, address target) internal {
```

## Event Ordering

Emit events before external calls (hooks, callbacks). This ensures events maintain chronological order even if hooks emit their own events:

```solidity
emit Swap(id, msg.sender, delta.amount0(), delta.amount1(), ...);
key.hooks.afterSwap(key, params, swapDelta, hookData, beforeSwapDelta);
```

## Type Safety

Prefer custom types over raw primitives. Use `using` to attach methods:

```solidity
type Currency is address;
type PoolId is bytes32;
type BalanceDelta is int256;

using {equals as ==} for Currency global;
```

Use SafeCast for all narrowing conversions:

```solidity
using SafeCast for *;
int128 amount = value.toInt128();
uint160 price = sqrtPrice.toUint160();
```

## Constants

Declare as `private constant` with explicit type. Place at the top of the contract after `using` declarations:

```solidity
int24 private constant MAX_TICK_SPACING = TickMath.MAX_TICK_SPACING;
int24 private constant MIN_TICK_SPACING = TickMath.MIN_TICK_SPACING;
```

## Magic Numbers

No inline literals except `0` and `1`. Extract everything else:

```solidity
uint256 private constant PRECISION = 1e18;
uint256 private constant MAX_FEE_BPS = 10_000;
uint24 private constant MAX_LP_FEE = 1_000_000;
```

Use underscores in large numeric literals for readability: `1_000_000`, `1e18`, `type(uint256).max`.

## Testing Style (Foundry)

```solidity
// Test contract naming: {Contract}Test
contract PoolManagerTest is Test {
    // Test function naming: test_{action}_{scenario}
    function test_swap_revertsWhenAmountIsZero() public {
    function test_initialize_setsCorrectTick() public {
    function test_modifyLiquidity_emitsEvent() public {

    // Fuzz test naming: testFuzz_{action}
    function testFuzz_swap_anyAmount(uint256 amount) public {
```

## Gas Patterns

- `calldata` over `memory` for external function parameters that are read-only
- Pack storage variables to share slots (uint128 + uint128, not uint256 + uint256)
- Use `immutable` for constructor-set values
- Custom errors over require strings (saves ~50 gas per revert)
- Short-circuit with early returns
- Cache storage reads in local variables when accessed multiple times

## Forbidden Patterns

- `tx.origin` for authorization
- `selfdestruct` / `SELFDESTRUCT`
- `require` with string messages in production code
- Floating pragma (`^0.8.x`)
- Wildcard imports
- `abi.encodePacked` for dynamic types (use `abi.encode`)
- Inline assembly without a documented safety justification
