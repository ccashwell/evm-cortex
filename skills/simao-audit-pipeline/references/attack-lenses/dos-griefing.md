# Lens 8 — Denial of Service & Griefing

You own availability. Your target is not "this could revert" — it is **a permanent or long-lived block on a function that must remain available, reachable by an attacker at low cost, with a real cost to someone else.**

The severity ladder that matters: funds permanently stuck > liquidations blocked (because bad debt accrues) > withdrawals blocked for a bounded period > core function unusable > admin function unusable.

## Attack surfaces

**Grow an unbounded array.** Any loop over a user-extendable structure — queues, pending removals, request lists, holder arrays, market lists — is an out-of-gas bomb if anyone can append cheaply. Ask for the batch parameter; note its absence.
> *DoSed `Voter::finalize()` due to unbounded pending removals lacking a batch argument variable*
> *`BatchOut::withdrawFulfill()` can be DoSed by spamming withdrawal requests, leading to OOG reverts*
> *`Treasury.noOfBorrowers` can be set to 0 by looping wei deposit<->withdrawals and DoS withdrawals and reset borrower debt*

**Poison one element of a batch.** A single reverting item in a loop that reverts the whole transaction. Reverting hooks, blacklisted recipients, zero-transfer-reverting tokens, and `address(0)` entries are all cheap to inject.
> *Halted withdrawals in BatchOut due to setting `withdrawTo` to `address(0)` in `scheduleWithdrawal()`*
> *Scheduled withdrawals with unsupported tokens will be halted*
> *`Claimers` can receive less `feePerClaim` than they should if some prizes are already claimed or if reverts because of a reverting hook*
> *If wLP is blacklisted, then user will not be able to withdraw it*
> *Gas Manipulation by Malicious Winners in `claimPrizes` Function*

**Exhaust a shared resource.** Buffers, caps, queues, and limits that any user can fill to lock everyone else out.
> *DOS of `completeQueuedWithdrawal` when ERC20 buffer is filled*
> *Attacker can DoS user withdrawals at no cost*
> *Anyone can grief users, stopping them from fulfilling their withdrawals*
> *Worker-Induced Denial-of-Service in Deployment Requests Due to Lack of a Cancellation Mechanism*

**Make the internal call impossible.** A function that internally deposits, withdraws, harvests, or rebalances will inherit every failure mode of the thing it calls. Full utilization, paused markets, frozen assets, and reverting receive hooks all propagate up into a core path that looks unrelated.
> *Market utilization ratio near 100% will DoS deposits as harvest tries to withdraw and reverts*
> *Frozen/paused Market that is harvested from in StakedEXA will DoS deposits leading to loss of yield*
> *Setting a new market will make depositing to the market impossible when harvesting, DoSing deposits*
> *Withdrawals can fail due to deposits reverting in `completeQueuedWithdrawal()`*
> *ETH withdrawals from EigenLayer always fail due to `OperatorDelegator`'s nonReentrant `receive()`*

**Interrogate the pause switches.** Pausing is meant to be selective and reversible. Check that pausing one thing does not block another that must stay live (repay, liquidate, withdraw), that the pause can actually be applied as documented, and that unpausing restores state.
> *Cannot repay or liquidate on paused asset*
> *Admin will not be able to only pause deposits in the `Vault` due to incorrect check leading to DoSed withdrawals*
> *Withdrawals and Claims are meant to be pausable, but it is not possible in practice*
> *`SpiritFactory` won't be able to stop the Airstream contract*

**Brick the upgrade or the config.** Permanent loss of administrative control is a real finding when it makes the contract unfixable.
> *Admin will not be able to upgrade the smart contracts, breaking core functionality and rendering the upgradeable contracts useless*
> *FeeManager's admin cannot grant or revoke any role*
> *Incompatibility of Upgradeability Pattern in TitlesGraph Contract*
> *Changing the epoch duration will completely break the vault and the slashers*

**Trap value with a state machine.** A state that cannot be exited, a request that cannot be cancelled, a flag that cannot be cleared, a threshold that can never be met.
> *`FluidLocker::_getUnlockingPercentage()` uses 540 instead of `540 days` leading to stuck funds*
> *It's impossible to retrieve collected fines from the yield staking contract*
> *Unhandled request invalidation by the owner of Etherfi will lead to stuck debt*
> *Users cannot unstake from YiedlETHStakingEtherfi.sol, because YieldAccount.sol is incompatible with ether.fi's WithdrawRequestNFT.sol*
> *Aura/Convex rewards are stuck after DOS*

**Overwrite index zero.** Sentinel-value bugs where "not found" returns 0 and the caller writes to slot 0, destroying a real entry.
> *In OstiumTradingStorage, `firstEmptyTradeIndex()` and `firstEmptyOpenLimitIndex()` overwrite index 0 if not found*

## Escalate before reporting

A DoS very often conceals a theft: while withdrawals are blocked, does the rate drift? Can the attacker withdraw during the window? Does the blocked liquidation let them keep an underwater position? Push every DoS to its worst variant before writing it up.

## Every finding needs the cost

State the attacker's cost (gas, capital, whether the capital is recoverable), the duration of the block (permanent vs bounded — say which), and who cannot do what. A DoS an attacker cannot afford to sustain is a LEAD.
