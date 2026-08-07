# Lens 9 — Access, Authorization & Trust Boundaries

You own the question of **who is allowed to do what, and whether the code actually enforces it.**

Not "this function is `onlyOwner`, is the owner trusted?" — that is not a finding. What you hunt is: a function that should check something and does not; a check that validates the wrong thing; a privileged role whose legitimate powers compose into theft; and every entry point the team forgot is an entry point.

## Attack surfaces

**Enumerate the real entry points.** List every `external`/`public` function and every callback, hook, receiver, and `fallback`. Callbacks are the ones teams forget: flash-loan handlers, cross-chain receivers, ERC721/1155 receivers, AMM swap callbacks, oracle fulfillments, keeper entry points. For each, ask what the caller is and whether that is checked.
> *Funds may be stolen by calling `onMoreFlashLoan()` directly*
> *ConnextHandler `executeFailedWithUpdatedArgs(...)` reentrancy allowedCaller can steal all ConnextHandler tokens*
> *In BaseRouter, the beneficiary isn't checked when starting a flashloan action and it replaces the previous beneficiary*

**Find the missing owner check.** Functions operating on someone else's position, NFT, or balance that never verify the caller owns it. Look especially at burn, close, cancel, adjust, and claim.
> *`deTokenize()` is missing access control, anyone can burn other people's nfts*
> *Anyone can get the NFT collateral token after an Auction without bidding due to missing check on msg.sender*
> *Anyone can deposit to DarkpoolAssetManager as the owner can be freely chosen without any implication*
> *`BaseTOFT.sol`: `retrieveFromStrategy` can be used to manipulate other user's positions due to absent approval check*

**Weaponize approvals.** Any contract that pulls tokens with `transferFrom` using caller-supplied `from`, `token`, or `target` parameters lets an attacker drain anyone who has approved it. This is a total-loss pattern and appears constantly in routers, payment helpers, and zaps.
> *Anyone who is approving `BlueprintV5` contract to spend ERC20 can get drained because `Payment::payWithERC20`*
> *A user with a TapiocaOFT allowance >0 could steal all the underlying ERC20 tokens of the owner*
> *Wrong `tokensToCheck` logic in BaseRouter enables attackers to steal funds*
> *Malicious path can be passed to redeem/withdraw() allowing an attacker to drain the strategy*

**Validate the target, not just the caller.** A permissioned caller passing an attacker-chosen contract address, market, path, strategy, or fee manager is the same exploit with extra steps. Check that every address parameter is whitelisted or derived, never trusted.
> *TOFT in (m)TapiocaOft contracts can be stolen by calling `removeCollateral()` with a malicious `removeParams.market`*
> *Pool Delegates can steal all the pool's funds by setting a malicious Withdrawal Manager*
> *Fixed term loans can be deployed with a wrong fee manager and possibly steal all funds*
> *Changing providers might lead to lost assets in BorrowingVault and YieldVault*

**Compose privileged powers into theft.** A role doing its job within its documented bounds, but the bounds are not enforced on-chain and the composition is a rug. This IS reportable when you can name the concrete mechanism and the parameter that is unbounded — unlike bare "centralization risk," which is not.
> *Pool Delegates can set a really high origination fee and steal all pool funds*
> *REBALANCER_ROLE can drain funds by rebalancing in a loop in the BorrowingVault*
> *Any duration can be passed by node operator*
> *A malicious operator will control consensus without risking stake (stake-exit lag exploit)*
> *Malicious operator can alone, with any voting power smaller than quorum, forge a proof*

**Check CEI and reentrancy on every value-moving path.** External call before state update, including token transfers to attacker-controlled contracts, ERC777/ERC721 hooks, and native sends. Also check the inverse: an over-broad `nonReentrant` on `receive()` that breaks legitimate flows.
> *Checks-effects-interactions pattern is not always followed, which can be used to drain all tokens*
> *ETH withdrawals from EigenLayer always fail due to `OperatorDelegator`'s nonReentrant `receive()`*

**Verify the proof, the root, and the nullifier — all of them.** In any commitment/proof system, check that every function validates the merkle root, that nullifiers cannot be reused or borrowed, and that the code validates the field it claims to validate. Swapping a nullifier check for a note-footer check reads as correct and is not.
> *MerkleRoot is not validated in all StakingAssetManager functions*
> *`UniswapLiquidityAssetManager::_validateCollectFeesArgs()` validates nullifier instead of note footer*
> *Attackers can include other users' nullifiers to make their funds stuck when adding liquidity to curve*
> *Note footers should not be 0 in `curveRemoveLiquidity()` if the corresponding assetOuts are non null*

**Take the counterfactual address.** Contracts deployed via CREATE2 or a factory can be claimed by whoever deploys first if initialization is not bound to the deployment.
> *Attacker can gain control of counterfactual wallet*
> *Credentials can be manipulated*

## Every finding needs the caller

Name who calls it, what they supply, what check is missing at which line, and what they walk away with. "Lacks access control" without a demonstrated impact path is a LEAD.
