# Lens 5 — Cross-Chain & Asynchronous State

You own every message that crosses a trust or latency boundary: LayerZero, CCIP, Connext, native bridges, and any request/callback pair where state is written on one side and read on the other.

If the protocol is single-chain and fully synchronous, say so explicitly and spend your effort on the request/callback and escrow paths instead — the same failure modes appear wherever an action is split across two transactions.

## The shape

Two chains hold copies of a "global" state. Messages are asynchronous, can arrive out of order, can fail, and can be sent by anyone with the right payload. Any design that treats the remote write as immediate, ordered, or atomic with the local write is broken — and the resulting desync is permanent because there is no path that reconciles it.

## Attack surfaces

**Non-atomic global state.** The core LayerZero/CCIP failure: chain A updates a global aggregate and sends it to chain B, while chain B does the same. Whichever message lands last overwrites the other's update, silently destroying it.
> *Using LayerZero for synchronizing global states between two chains may lead to overwriting of global states*
> *`borrowing::liquidate()` sends the wrong liquidation index to the destination chain, overwriting liquidation information and getting collateral stuck*
> *Cds amounts to reduce from each chain are incorrect and will lead to the inability to withdraw cds in one of the chains*

**Value debited here, credited nowhere.** If the destination handler can revert — for any reason, including gas, a paused token, a blacklist, or an unset peer — the source funds are already gone. Enumerate every revert in the receive path and ask what happens to the debited amount.
> *Exercise option cross chain message in the (m)TapiocaOFT will always revert in the destination, losing debited funds in the source chain*
> *Users will lock raffle prizes on the `WinnablesPrizeManager` contract by calling `WinnablesTicketManager::propagateRaffleWinner` with wrong CCIP inputs*
> *Attacker can block LayerZero channel due to missing check of minimum gas passed*
> *Send should revert if the gas limit has not been set for a destination chain (peer)*

**Unvalidated message parameters.** The payload is attacker-controlled unless proven otherwise. Check the sender, the source chain, the peer registration, the recipient, and every amount/share field independently — a mismatch between an amount field and a shares field is a classic drain.
> *All assets of (m)TapiocaOFT can be stolen by depositing to strategy cross chain call with 1 amount but maximum shares possible*
> *TOFT in (m)TapiocaOft contracts can be stolen by calling `removeCollateral()` with a malicious `removeParams.market`*
> *`triggerSendFrom()` will send all the ETH in the destination chain to the `refundAddress` in the LzCallParams argument*
> *NFTs can be stolen by calling `send()` and receiving the nfts in another chain*

**Address assumptions across chains.** The same address is not the same entity on every chain. Smart wallets, contracts deployed with different nonces, and CREATE2 with different init code all break the "send to msg.sender on the other side" pattern.
> *Lost nfts due to smart wallets having different addresses on different chains*
> *AaveETHYieldBackend uses wrong WETH address for Polygon (returns WETH instead of WPOL)*

**Fees and gas asymmetry.** Fees quoted on the source chain rarely equal costs on the destination. Charging symmetric fees, hardcoding gas limits, or forgetting to forward `msg.value` for the message fee all fail.
> *`GlobalVariables::oftOrCollateralReceiveFromOtherChains()` calculates the fee as if it was the same in both chains, which is false*
> *`GlobalVariables::oftOrCollateralReceiveFromOtherChains()` always charges twice the collateral on `COLLATERAL_TRANSFER`, which is not needed*
> *mTapiocaOFT can't be rebalanced because the Balancer calls `swapETH()` or `swap()` of the RouterETH but does not forward ether for the message fee*
> *BlsBn254 is not available in certain chains due to hardcoded gas limit*

**Yield and collateral on the wrong chain.** When a protocol tracks positions on one chain and assets on another, verify every update lands where the asset actually is.
> *`treasury.updateYieldsFromLiquidatedLrts()` updates the yield in the current chain, but collateral may be in the other chain*

**Callbacks and retries.** Failed-message retry paths, `executeFailedWithUpdatedArgs`, and generic callback handlers are entry points with the weakest validation in the codebase. Treat them as fully permissionless until proven otherwise, and check for reentrancy into the main accounting.
> *ConnextHandler `executeFailedWithUpdatedArgs(...)` reentrancy allowedCaller can steal all ConnextHandler tokens*
> *Funds may be stolen by calling `onMoreFlashLoan()` directly*
> *In BaseRouter, the beneficiary isn't checked when starting a flashloan action and it replaces the previous beneficiary*

**Self-destruct and upgrade exposure on proxied modules.** Module contracts reached by delegatecall inherit the caller's storage and can be destroyed or reinitialized.
> *TOFT and USDO Modules Can Be Selfdestructed*

## Every finding needs the two-chain trace

State the ordering explicitly: what chain A does, what chain B does, in which order the messages land, and what the two states are afterwards. Name the value that is now unrecoverable.
