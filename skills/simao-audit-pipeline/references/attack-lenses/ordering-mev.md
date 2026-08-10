# Lens 7 — Ordering, MEV & Price Manipulation

You own everything that depends on *when* a transaction lands relative to others: frontrunning, sandwiching, initialization races, oracle reads, and arbitrage against discrete state changes.

The bar matters here. Ordinary slippage on a swap a user chose is not a finding. What you are hunting is (a) protocol-owned value exposed to MEV without protection, (b) a state change large enough to arbitrage, and (c) a one-shot action anyone can win.

## Attack surfaces

**Win the initialization race.** Any `initialize`, first-deposit, pool-creation, or set-once function callable by anyone before the deployer gets there. These are consistently High: an arbitrary initial price or an attacker-owned proxy is total loss.
> *Uniswap v4 pool initialization can be frontrunned, setting an arbitrary price, and stealing tokens*
> *`BoldToken` initialization can be frontrun to silently mint/approve bold to an attacker*
> *Missing `__Ownable_init()` call in `LenderCommitmentGroup_Smart::initialize()`*
> *`Codeup::claimCodeupERC20()` may be forever DoSed by creating the `Uniswap` pool before it is called*

**Find protocol-owned swaps with no protection.** A permissionless function that swaps protocol funds with `amountOutMin = 0` or `deadline = block.timestamp` is free money for a sandwicher, and the protocol — not a consenting user — pays.
> *Distribute is permissionless, allowing malicious users to specify 0 slippage and sandwich the swap*
> *Swapping with deadline as `block.timestamp` and 0 minimum amount out is vulnerable to MEV*
> *`UniswapV2Swapper` uses `block.timestamp` for deadline*
> *`_addLiquidity()` slippage is incorrectly set*
> *Lack of deadline in `PowerToken.buy` can lead to user's cashToken being distributed through ZeroToken holders*

**Arbitrage the discrete jump.** Any transaction that steps a rate, TVL, price, or reserve discontinuously can be front-run on one side and back-run on the other. Look for admin rate updates, reward top-ups, rebalances, and TVL syncs.
> *`increaseNetworkTotal()` allows big arbitrage opportunities by depositing before an increase transaction*
> *Withdrawals logic allows MEV exploits of TVL changes and zero-slippage zero-fee swaps*
> *`_rebalanceWithdraw()` mechanism in glAVAX allows arbitrage opportunities by changing the shares/AVAX ratio*
> *Price formula in `TpdaLiquidationPair._computePrice()` does not account for a jump in liquidatable balance*
> *Drained oracle fees from market by depositing and withdrawing immediately without triggering settlement fees*

**Read the manipulable price.** `slot0`, spot reserves, and any vault rate derived from a live balance are manipulable within a single transaction. Distinguish a genuine TWAP from a spot read dressed as one, and check which price the protocol picks when several are available.
> *Strategy main ticks are set according to the tick in `slot0`, leading to incorrect allocation and loss of funds*
> *`LenderCommitmentGroup_Smart` picks the wrong Uniswap price, allowing borrowing at a discount by swapping before withdrawing*
> *Interest rate in `LenderCommitmentGroup_Smart` may be easily manipulated by depositing, taking a loan and withdrawing*
> *`PHyperLPoolSwapInside::_rebalance()` checks the price manipulation before and after the swap with the same price threshold*
> *Locker owners can leverage low liquidity pools to bypass the tax mechanism*

**Front-run for grief, not profit.** Cancelling a raffle before it starts, claiming a one-shot right, resetting someone's timer, or triggering a state transition to block another user. Cost to the attacker is often near zero.
> *Attacker will prevent any raffles by calling `WinnablesTicketManager::cancelRaffle` before admin starts raffle*
> *Malicious user may frontrun `GoodDollarExpansionController::mintUBIFromReserveBalance()` to make protocol funds stuck*
> *Anyone can frontrun a relayer interaction with the same arguments but a much higher/lower relayer fee*
> *Anyone will DoS setting a new rewards duration which harms the protocol/users*

**Break the approval window.** Functions taking shares (rather than assets) as an argument, or relying on a prior approval, can be made to revert or over-spend if state moves between approval and execution.
> *`repay()`, `liquidate()` and `liquidateWLp()` receive shares as argument, which may revert if from approval to tx settled blocks have passed*
> *`safeApprove(...)` reverts if approval is different than 0, use `safeIncreaseAllowance(...)` instead*
> *`FlashRolloverLoan_G5` will not work for certain tokens due to not setting the approval to `0` after repaying a loan*

**Replay the signature.** Missing nonce, missing deadline, missing chain id, zero timestamp accepted, or parameters excluded from the signed digest so an attacker can pair a valid signature with hostile arguments.
> *Validator signature with zero timestamp can always be replayed*
> *Signature Replay attack possible on `updateWorkerDeploymentConfigWithSig()` in Blueprintcore.sol which leads to users losing funds*
> *Signatures missing some parameters being vulnerable to attackers using them coupled with malicious parameters*
> *All curve params should be signed by the schnorr private key in the proof, or users may be griefed*

## Every finding needs the ordering

State the transaction sequence explicitly: attacker tx, victim tx, attacker tx. Give the attacker's cost and profit. If the attack is a grief, state the cost to the attacker (often zero) and the damage to the victim.
