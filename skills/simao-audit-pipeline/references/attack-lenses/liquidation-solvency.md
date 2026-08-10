# Lens 4 — Liquidation, Bad Debt & Solvency

You own the machinery that keeps a lending or leverage protocol solvent: health calculations, liquidation eligibility, seize amounts, bonuses, bad-debt clearing, and the interaction between liquidation and every other accounting path.

Liquidation is where the most accounting variables move at once, under the most adversarial conditions, and it is the path teams test least. It is one of his richest veins.

## The shape

Liquidation must (a) be possible whenever the position is unhealthy, (b) be impossible when it is healthy, (c) leave the books balanced afterwards, and (d) actually clear the bad debt it was meant to clear. Break any one and you have either a stuck insolvent position or a profitable attack.

## Attack surfaces

**Block the liquidation.** Anything an unhealthy borrower can do to make liquidation revert or become unprofitable is a High — bad debt accrues and the protocol eats it. Look for: paused assets, reverting hooks, dust positions, minimum-debt floors, ordering requirements, gas-unbounded loops, and self-triggerable state that resets a timer.
> *Cannot repay or liquidate on paused asset*
> *Liquidations can be prevented by frontrunning and liquidating 1 debt (or more) due to wrong assumption in POS_MANAGER*
> *Liquidations can be prevented by updating the SL timeout before it expires*
> *`Market::liquidate()` will not work when most of the liquidity is borrowed due to wrong liquidator `transferFrom()` order*
> *Malicious users can DOS the protocol by setting downsideProtected to a large value*

**Check the health formula against the liquidation formula.** The predicate that says "liquidatable" and the math that executes the liquidation are often written by different people. Verify they agree at the boundary, and that the max liquidatable amount accounts for the bonus — otherwise the position is still unhealthy after a full liquidation.
> *`ViewLogic::maxLiquidatable()` doesn't take the bonus into account, making the agent liquidatable again*
> *Base calculation in `Leverager::isLiquidateable()` is incorrect as the max leverage may be smaller*
> *Contradiction between high-leverage and liquidation check of position*
> *`TARGET_HEALTH` calculation does not consider the adjust factors of the picked seize and repay markets*
> *The health of a `ProtectedListing` is incorrectly calculated if `tokenTaken` has been changed through `adjustPosition()`*

**Accrue before you judge.** Interest, earnings accumulators, and cumulative rates must be brought current before any health check or liquidation, or positions are judged on stale numbers and liquidations become profitable-but-wrong.
> *Profitable liquidations and accumulation of bad debt due to earnings accumulator not being triggered before liquidating*
> *Market interest is not always accrued*
> *It's possible to borrow, redeem, transfer tokens and exit markets with outdated collateral prices and borrow interest*
> *Liquidating maturities with unassigned earnings will not take into account floating assets increase leading to loss of funds*

**Follow every variable liquidation touches.** Liquidation moves collateral, debt, insurance, profit, and protocol totals simultaneously. Trace each one and confirm the counterpart update exists. Missing counterparts here are his signature High.
> *Liquidation will reduce total cds deposited amount, leading to incorrect option fees*
> *Type 1 borrower liquidation will incorrectly add cds profit directly to `totalCdsDepositedAmount`*
> *Liquidation profit is never given to cds depositors who will take these losses*
> *Some liquidated collateral will be locked*
> *Missing Update to `omnichain.totalAvailableLiquidationAmount` in `withdrawUser`*

**Verify bad debt actually clears.** A clearing function that leaves dust, or that only works on the last maturity, or that leaves unassigned earnings claimable by anyone, means insolvency accumulates silently.
> *Liquidations will leave dust when repaying expired maturities, making it impossible to clear bad debt putting the protocol at a risk of insolvency*
> *Some bad debt will not be cleared when it should which will cause accrual of bad debt decreasing the protocol's solvency*
> *Liquidator will leave a pool with unassigned earnings on `Market::clearBadDebt()` free to claim for anyone when the repaid maturity is not the last*
> *Bad debt is never handled which places insolvency risks on BendDAO*

**Cap the price and the seize.** Unbounded liquidation prices, unprioritized collateral selection, and missing slippage on the liquidator's swap all leak value.
> *Major insolvency risk in `LiquidationLogic::executeCrossLiquidateERC721()` due to not setting a maximum liquidation price*
> *Liquidation does not prioritize lowest LTV tokens*
> *Liquidations miss delegate call to swapper*
> *Lack of slippage protection leads to loss of protocol funds*

**Probe the leverage-adjustment boundary.** Increase/decrease leverage, partial repay, and position adjustment paths must respect minimum debt, maximum debt, and fees. They routinely do not.
> *`ManagedLeveragedVault::decreaseLeverage()` will not work when it goes below the minimum debt*
> *`ManagedLeveragedVault::executeWithdrawalEpoch()` incorrect ICR and DoSed withdrawals due to not accounting for fees*
> *DoSed withdrawals due to `ManagedLeveragedVault::executeWithdrawalEpoch()` repaying debt above limit*

## Every finding needs the position

Give the concrete position: collateral amount, debt amount, price, resulting health factor before and after. State whether the protocol is left short and by how much.
