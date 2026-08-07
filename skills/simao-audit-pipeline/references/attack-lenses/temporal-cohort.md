# Lens 3 — Temporal Cohorts & Distribution Fairness

You own the question that produces 0xSimao's most distinctive findings: **when value is distributed pro-rata among a changing set of holders, who actually gets it?**

Other lenses ask whether the total is right. You ask whether the *split* is right, and whether someone can arrive just in time to take a share of value they did not earn — or leave just in time to dump a loss on whoever stays.

## The shape

Accumulated value is distributed using a *current* snapshot: current total supply, current deposits, current balance. But the value accumulated over a *past* period during which the holder set was different. Anyone who joins between accrual and distribution is paid for time they were not present.

The mirror image is equally productive: a loss realized against current holders lets the actor who caused it exit first.

## Attack surfaces

**Join immediately before a distribution.** For every reward, yield, fee, liquidation profit, or expansion event: can an actor deposit in the same block (or one block before) and claim a pro-rata share of value accrued earlier? Flash loans make the capital requirement irrelevant, so size is never a defense.
> *Immediately start getting rewards belonging to others after staking*
> *Late abond holders steal USDa amount from liquidations from earlier abond holders*
> *`increaseNetworkTotal()` allows big arbitrage opportunities by depositing before an increase transaction*
> *Cds depositors profit up to the strike price is not redeemable as the total cds deposited amount is not increased*

**Leave immediately before a loss.** Can an actor whose position created a shortfall exit before it is realized, leaving remaining holders to absorb it?
> *Borrower withdrawing at a loss will cause losses for cds depositors that only withdraw after the price recovers*
> *Total cds deposited amount is incorrectly modified when cds depositor is at a loss, leading to stuck USDa*

**Audit every cumulative index and rate.** Index-based accounting is correct only if the index advances exactly once per unit of time/value and every user's snapshot is taken at the right moment. Check: can the index be advanced for free? Is `lastUpdate` written every time the index is? Is the user's checkpoint set on deposit, on transfer, and on receiver-different-from-sender deposits?
> *Malicious user can call `borrowing::calculateCumulativeRate()` any number of times to inflate debt rate as `lastEventTime` is not updated*
> *Unconditional lastUpdated advance in RangePool.sync leads to loss of streamed BMX when pool liquidity == 0*
> *Accumulated profit/losses by the cumulative value is not dealt with in `borrowingLiquidation::liquidationType1()`, leading to losses*
> *Inconsistent Use of `lastCumulativeRate` in `depositTokens()` and `withdraw()` Functions*

**Attack the checkpoint on behalf-of paths.** Depositing for another receiver, transferring a position, or having a third party trigger an update frequently sets a timestamp or snapshot without settling what was owed first.
> *Depositing to another receiver other than `msg.sender` will lead to stuck funds by increasing `avgStart` without claiming*
> *Attackers will reset `avgStart` of any user making rewards stuck for longer and get lost to savings*
> *An attacker may DoS user Fluid balance increases by frontrunning `FluidLocker::claim()` calls and calling `EP_PROGRAM_MANAGER::batchUpdateUserUnits()` directly*

**Distribute into an empty or stale set.** Rewards queued when supply is zero, an emission period extended after it ended, a sync called at the wrong point in the cycle. Where do those tokens go, and can they be recovered?
> *Lost rewards when the supply is 0, which always happens if rewards are queued before anyone has StakeTracker tokens*
> *Having no deposits in `StakedEXA` will lead to stuck rewards when harvesting*
> *Increasing emissionEnd after the previous emissionEnd ended will yield full rewards according to `newEmissionEnd - prevEmissionEnd`*
> *Wrong reward distribution between early and late depositors because of the late `syncRewards()` call in the cycle*

**Compare compounding against non-compounding holders.** When a protocol supports both, verify neither systematically drifts against the other.
> *Compounding shares will over time get less rewards than non compounding shares*

**Vote and claim more than once.** Any per-epoch entitlement — votes, claims, prizes, allocations — needs a consumed flag that survives transfers, re-locks, and epoch boundaries.
> *Voters from VotingEscrow can vote infinite times in `vote_for_gauge_weights()` of GaugeController*
> *Finalize-window vote-changing vulnerability: auto-voters can alter choices post-epoch to manipulate results*
> *Double spending attack in the Vesting contract*

## Required test

For each distribution path, write the two-user timeline explicitly: Alice deposits at t0, value V accrues by t1, Bob deposits at t1, distribution happens at t2. Compute what each receives. If Bob receives anything from the t0→t1 accrual, that is the finding — quantify Alice's loss.

## Every finding needs the timeline

Two named actors, three timestamps, and the amounts each ends with. Without them it is a LEAD.
