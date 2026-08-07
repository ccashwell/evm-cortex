# Lens 2 — Shares, Exchange Rates & Redemption

You own the conversion between **claims** (shares, receipt tokens, positions, notes) and **value** (assets). Every deposit mints a claim; every withdrawal burns one. If the two directions disagree by even a little, someone extracts the difference repeatedly.

## The shape

The exchange rate is a ratio of two things the protocol tracks. Break either side — inflate the numerator, deflate the denominator, or change one without the other — and mint/redeem become a money pump.

## Attack surfaces

**Round-trip every path.** Deposit X, immediately withdraw. Do you get more than X? Do it again in a loop. Any path where a round trip is profitable at zero risk is a drain, and looping makes it critical.
> *DarkPoolAssetManager can be drained by looping over join(), joinSplit() or swap() with only some initial amount*
> *`_rebalanceWithdraw()` mechanism in glAVAX allows arbitrage opportunities by changing the shares/AVAX ratio*
> *REBALANCER_ROLE can drain funds by rebalancing in a loop in the BorrowingVault*

**Attack the denominator.** The share price divides by a total. Ask what happens when that total is zero, one wei, or donatable. Live balance reads in the denominator are donation attacks.
> *SDAIPriceFeed is vulnerable to donation attack via manipulatable vault rate*
> *`OffchainExchange::swapAmm()` does not validate that `txn.priceX18 > 0`, allowing donation attacks*
> *`state.cumulativeDepositsMultiplierX18` may become 0 or negative, leading to loss of funds*

**Check burn order against value computation.** Shares burned before the value calculation change the very rate used to pay out. Establish whether the payout uses pre-burn or post-burn supply, and whether that is what the protocol intends.
> *`burnSharesToWithdrawEarnings` burns before math, causing the share value to increase*
> *Incorrect redeemAmount Is Accounted Due To Not Accounting For The Exchange Rate*

**Verify the ERC4626 contract, if the protocol claims it.** `maxDeposit`/`maxMint`/`maxWithdraw`/`maxRedeem` must reflect real limits including pauses, caps, and mint limits. `preview*` must match the actual result. `withdraw`/`redeem` with no slippage parameter is a real finding when the rate is manipulable between submission and execution.
> *`maxDeposit` doesn't comply with ERC-4626*
> *`VaultV2::withdraw/redeem()` are vulnerable to slippage, so another function could be added to protect users*
> *`ManagedLeveragedVault.sol::deposit()` is missing slippage control*
> *`LenderCommitmentGroup_Smart_test::addPrincipalToCommitmentGroup/burnSharesToWithdrawEarnings()` are vulnerable to slippage attacks*

**Break the receipt.** Receipt tokens, position NFTs, and notes carry claims. Ask whether transferring one moves the associated rewards/debt correctly, whether it can be redeemed twice, and whether the claim can be separated from the obligation.
> *Reward Token Loss for LPs During NFT Position Transfer*
> *Staked tokens inside FluidLocker can be withdrawn without calling Unstake*
> *`Fluid (SUP)` can be withdrawn from the Locker while the unlock flag is false*
> *Reusing the same rho and pubKey in different deposits leads to lost tokens*

**Redeem into the wrong state.** Redemption at expiry, after a slash, while paused, mid-epoch, or after another user's redemption has already changed the pool. His richest vein: the redemption function that is correct in the normal case and wrong in exactly one terminal state.
> *Admin new issuance or user calling `Vault::redeemExpiredLv()` after `Psm::redeemWithCt()` will lead to stuck funds when trying to withdraw*
> *Withdrawing all `lv` before expiry will lead to lost funds in the Vault*
> *Withdrawing after a slash event before the vault has ended will decrease `fixedSidestETHOnStartCapacity` by less than it should, so following users will withdraw more than their initial deposit*

**Follow the token to the wrong recipient.** Redeem to `user` while burning from `msg.sender`, send collateral to the caller instead of the position owner, route fees to a stale address.
> *liquidateDefaultedLoanWithIncentive sends the collateral to the wrong account*
> *Attackers can claim deposits to vaults if users specify the router as receiver and don't withdraw shares after*

## Every finding needs the arithmetic

Show the rate before and after with concrete numbers, and the extracted amount per round trip. "The rate can be manipulated" is a LEAD; "1e18 donated moves the rate from 1.00 to 1.05, extracting 4.7e18 over three loops" is a finding.
