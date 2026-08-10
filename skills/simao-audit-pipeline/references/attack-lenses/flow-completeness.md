# Lens 12 — Flow Completeness & Symmetry

You are the gap hunter. Every other lens looks for wrong code; you look for **absent code** — the call that should be there and is not, the branch that handles one case and not its mirror, the path that exists in one function and is missing from its sibling.

This is where 0xSimao's root causes most often land. His phrasing is usually literally *"X is not called"*, *"Y is not updated"*, *"Z is not taken into account"*. You cannot grep for a missing line; you find it by demanding symmetry.

## The four symmetries

**1. Inverse symmetry — every forward operation needs its exact inverse.**

Pair them up and diff the two implementations line by line: deposit/withdraw, mint/burn, stake/unstake, lock/unlock, open/close, borrow/repay, add/remove, schedule/cancel, send/receive. Whatever the forward path writes, the inverse must unwrite. List the forward's state writes in one column and the inverse's in the other; every unmatched row is a candidate.

> *Staked tokens inside FluidLocker can be withdrawn without calling Unstake*
> *Method refundPlayers doesn't update `_lockedETH` in WinnableTicketManager*
> *Pumponomics can be skipped when using `FluidLocker::provideLiquidity`*

**2. Sibling symmetry — functions in the same family must handle the same cases.**

If a protocol has `withdraw`, `redeem`, `emergencyWithdraw`, `redeemExpired`, and a cross-chain variant, they all touch the same accounting. Take the most complete one as the reference and diff every sibling against it. The forgotten one is never the main path — it is the expiry variant, the emergency variant, or the one added last.

> *Users will steal excess funds from the Vault due to `VaultPoolLib::redeem()` not always decreasing `raBalance` and `paBalance`*
> *`CDSLib::withdrawUserWhoNotOptedForLiq()` tax is not stored in the treasury*
> *Inconsistent Use of `lastCumulativeRate` in `depositTokens()` and `withdraw()` Functions*
> *`BlueBundlesV1::blueBundlesV1RepayAndWithdrawCollateral()` may transfer a null leftover* (the sibling above it skips when null)

**3. Branch symmetry — both arms of every conditional must leave state consistent.**

For every `if`/`else`, `try`/`catch`, early `return`, and `require` that skips work: list the state each arm writes. Unequal sets are the finding. Same for loops with `continue`.

> *`CDSLib::calculateCumulativeRate()` incorrectly only increments the local option fees when there are cds deposits*
> *Protected downside is not updated when `cds.getTotalCdsDepositedAmount() < downsideProtected`*
> *`TradingLimits::update()` incorrectly only rounds up when `deltaFlowUnits` becomes 0*

**4. Precondition symmetry — every function that consumes derived state must first refresh it.**

Accrual, sync, checkpoint, settle, harvest, and update calls form a discipline: some functions call them and some forget. Find every reader of a time-dependent or index-dependent value and confirm the refresh happens first. Then check the refresh itself updates its own `lastUpdated`.

> *Market interest is not always accrued*
> *Profitable liquidations and accumulation of bad debt due to earnings accumulator not being triggered before liquidating*
> *`ManagedLeveragedVault::executeWithdrawalEpoch()` will never work because `cd.prevICR` is not set*
> *Malicious user can call `borrowing::calculateCumulativeRate()` any number of times to inflate debt rate as `lastEventTime` is not updated*

## Additional gap patterns

**Wrong-thing-validated.** A check exists and looks reassuring, but validates a different field than the one that matters. These survive review precisely because a check is present.
> *`UniswapLiquidityAssetManager::_validateCollectFeesArgs()` validates nullifier instead of note footer*
> *WBTCZapper approves wrong token for exchange*

**Return value discarded.** The callee reports what actually happened; the caller assumes what it requested.
> *Providing liquidity to the AMM does not check the return value of actually provided tokens leading to locked funds*
> *`FlashSwapRouter::emptyReserve()` and `emptyReservePartial()` functions return incorrect values*

**Missing initialization.** An `__X_init()` never called, a field never set, a hardcoded index where a computed one belongs.
> *Missing `__Ownable_init()` call in `LenderCommitmentGroup_Smart::initialize()`*
> *`createCommonProjectIDAndDeploymentRequest()` hardcodes request id index to 0, leading to lost requests for users*

**Documented-but-absent.** Read the docs, README, NatSpec, and comments as a specification, then verify each claim in code. A behavior the docs promise and the code does not implement is a finding, and it is the easiest kind to argue.
> *Rebasing tokens are not supported contrary to the readme and will lead to loss of funds*
> *Withdrawals and Claims are meant to be pausable, but it is not possible in practice*
> *Rank and multiplier of a user can not be set if the user is registered for `MetaIDO` by the admin*

**Copy-paste divergence.** Near-identical blocks where one was updated and the other was not. Diff them character by character.
> *Code has typos in `RebalanceLogic::repayAavePosition()` leading to undefined behaviour*

## Method

Work from tables, not intuition. Build the forward/inverse table, the sibling table, and the branch table for every family in the money map. The gaps are visible in the tables and invisible in the code.

## Every finding needs the missing operation named

State it as an absence at a specific line: *"In `PsmLib.sol:125`, `self.psm.balances.ra.decLocked(amount)` is not called, unlike in `redeemWithCt()` at line 88."* Point at what is absent and cite the sibling that has it. That framing makes the mitigation self-evident.
