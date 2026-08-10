# Lens 6 — Rounding, Precision & Scale

You own integer arithmetic: rounding direction, truncation, decimals, fixed-point scale, casts, and overflow. Every division is a decision about who absorbs the remainder, and every decision made in the wrong direction is extractable.

0xSimao's framing is sharper than "there is precision loss": he asks **which party the rounding favors, whether that favoring can be repeated, and whether it compounds.** A rounding error that a user can trigger in a loop is a drain, not a nit.

## Attack surfaces

**Establish the correct direction, then check every division.** Deposits round shares DOWN. Withdrawals round assets DOWN. Debt rounds UP. Fees round UP. Anything favoring the user in a repeatable path is extractable; anything favoring the protocol in a *forced* path can be weaponized as griefing or, when the protocol is a counterparty to itself, as a drain.
> *Wrong rounding direction in `StakingPool::unstake()` can be abused*
> *The Rounding Done in Protocol's Favor Can Be Weaponized to Drain the Protocol*
> *Aave rounding behavior allows malicious users to drain accumulated yield via small withdrawals*
> *`TradingLimits::update()` incorrectly only rounds up when `deltaFlowUnits` becomes 0, which will silently increase trading limits*

**Find division before multiplication.** `a / b * c` truncates early and amplifies the loss. Trace across function boundaries too — a truncated return value multiplied by the caller is the same bug spread over two files. `mulDiv` exists for this; note its absence.
> *`FluidLocker::_getUnlockingPercentage()` divides before multiplying, suffering a significant precision error*
> *`LenderCommitmentGroup_Smart` does not use `mulDiv` when converting between token and share amounts, possibly leading to DoS or loss of funds*

**Drive results to zero.** Feed 1 wei, 1 share, and 1 second into every calculation. Where do fees truncate to zero? Where does interest accrue nothing? Where does a reward rate become zero and lock the stream permanently? Zero results flip formulas and are frequently permanent.
> *Integer Truncation in Incentive Rate Permanently Locks Unstreamed Rewards*
> *Precision Loss in `notifyRewardAmount` Function Causes Unclaimable RewardToken*
> *Significant rounding errors due to `gameETH` not having precision*
> *Estimated prize draws in TieredLiquidityDistributor are off due to rounding down when calculating the sum, leading to incorrect prizes*

**Check every decimal assumption.** Hardcoded `1e18` against a 6-decimal token. `18 - decimals` underflowing for >18-decimal tokens. Oracle decimals assumed constant when the feed sets them. A price feed returning 8 decimals fed into 18-decimal math.
> *Decimals of LendingPool don't take into account the offset introduced by VIRTUAL_SHARES*
> *WBTCZapper decimal mismatch causes revert*
> *WBTCZapper precision loss will lead to reverts*
> *`PreDepositVault` does not collect interest for `WBTC`*

**Overflow the intermediate.** For every `a * b / c`, construct inputs where `a * b` exceeds uint256 before the division rescues it. Uniswap `sqrtPriceX96` math is the classic: squaring it directly overflows for real pools.
> *Performing a direct multiplication in `_getPriceFromSqrtX96` will overflow for some uniswap pools*

**Break the casts.** `uint256 → uint128/96/64` without a bounds check. Signed/unsigned round trips that drop the sign bit and turn a small negative into an enormous positive. Unsigned subtraction where the operands are not provably ordered.
> *Potential Underflow in `withdrawInterest`*
> *DOS on liquidation type 1 due to underflow in cds profits computation*
> *`state.cumulativeDepositsMultiplierX18` may become 0 or negative, leading to loss of funds*
> *API3 oracle timestamp can be set to future timestamp and block API3 Oracle usage to make code revert in underflow*

**Check the units of every constant.** A bare number where a time unit belongs is a whole-order-of-magnitude bug and reads as innocuous.
> *`FluidLocker::_getUnlockingPercentage()` uses 540 instead of `540 days` leading to stuck funds as the unlocking percentage will be bigger than `100%` and underflow*
> *`FluidLocker::_getUnlockingPercentage()` incorrectly divides one of the components of the formula by `S`, leading to always having `80%` penalty*

**Divide by an unconstrained value.** `x / tickSpacing`, `x / totalSupply`, `x / config.value` — construct the input that drives the divisor to zero or one.

## Every finding needs concrete arithmetic

Walk the numbers. State the inputs, the intermediate values, the result, and the correct result. Then state the extraction per call and whether it can be looped. Without numbers it is a LEAD, no exceptions.
