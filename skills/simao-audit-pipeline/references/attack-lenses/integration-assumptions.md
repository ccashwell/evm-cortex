# Lens 10 — Integration & Environment Assumptions

You own every assumption the code makes about something it does not control: external protocols, token behavior, oracles, and the chain itself.

The method is always the same. Find the assumption, then find the real-world instance that violates it. A finding here is only real when you can **name the specific token, pool, feed, or chain** that breaks it.

## Token behavior

The protocol's own docs usually claim which tokens are supported. Check the code against that claim in both directions — unsupported behavior that is not blocked, and supported behavior that is not handled.

- **Fee-on-transfer** — received ≠ requested. Any code storing the requested amount is now over-crediting.
  > *Fee on transfer tokens transfer less tokens than what is stored in the receipt on deposits*
  > *`LenderCommitmentGroup` pools will have incorrect exchange rate when fee-on-transfer tokens are used*
- **No revert on failure** (USDT-era, some bridged tokens) — an ignored return value means a silent no-op that still credits the user.
  > *Anyone can steal pool shares from lender group if no-revert-on-failure tokens are used*
- **Non-standard approve** — USDT reverts on non-zero→non-zero; `safeApprove` reverts on the same.
  > *`safeApprove(...)` reverts if approval is different than 0, use `safeIncreaseAllowance(...)` instead*
  > *`PreDepositVault` will not work for USDT*
  > *`FlashRolloverLoan_G5` will not work for certain tokens due to not setting the approval to `0` after repaying a loan*
- **Blacklists** — a blacklisted address in a batch or a forced push-transfer bricks the path.
  > *If wLP is blacklisted, then user will not be able to withdraw it*
- **Rebasing / non-18 decimals / zero-transfer reverts** — check each against what the docs promise.
  > *Rebasing tokens are not supported contrary to the readme and will lead to loss of funds*
  > *Missing several `safeERC20` functions*

## Oracles

- Missing or wrong staleness, round-completeness, and min/max-answer checks; and what the fallback returns.
  > *WSTETHPriceFeed returns USD price instead of EUR on oracle failure*
  > *Attacker can trigger temporary shutdown due to RedStonePriceFeedBase missing gas check*
- Timestamps that can be set in the future, causing underflow in a staleness subtraction.
  > *API3 oracle timestamp can be set to future timestamp and block API3 Oracle usage to make code revert in underflow*
  > *API3 oracle future timestamp causes temporary DoS via underflow*
- Rates derived from a vault or LP that can be donated to, and spot reads dressed as price feeds.
  > *SDAIPriceFeed is vulnerable to donation attack via manipulatable vault rate*
- Feed availability on every chain the protocol claims to deploy on.
  > *Witnet is not available on some networks listed*

## External protocol coupling

Read the integrated protocol's actual interface and semantics — do not assume. Version differences, return-value meanings, and callback requirements are where these break.

> *Users cannot unstake from YiedlETHStakingEtherfi.sol, because YieldAccount.sol is incompatible with ether.fi's WithdrawRequestNFT.sol*
> *AaveV3 RewardsController provides rewards in any token, should be handled separately*
> *Aave rounding behavior allows malicious users to drain accumulated yield via small withdrawals*
> *`FlashRolloverLoan_G5` will fail for `LenderCommitmentGroup_Smart` due to `CollateralManager` pulling collateral from `FlashRolloverLoan_G5`*
> *Incorrect selector in `FlashRolloverLoan_G5::_acceptCommitment()` does not match `SmartCommitmentForwarder::acceptCommitmentWithRecipient()`*
> *`CurveAssetManagerHelper::_validateAssets()` should check that the number of assets provided is smaller than the maximum of the pool*
> *Curve multi exchange does not validate assetIn and assetOut against route*
> *Stuck ETH in Curve exchanges due to sending `msg.value` to the exchange instead of `amountIn`*

Check every hardcoded address against the chain it will run on, and every hardcoded selector against the real interface.
> *AaveETHYieldBackend uses wrong WETH address for Polygon (returns WETH instead of WPOL)*

## Chain environment

- **zkSync** — `transfer`/`send` gas stipend semantics differ; contract addresses differ from EVM CREATE2; `block.timestamp` behavior and time-sensitive logic need review.
  > *Time-sensitive contracts deployed on zkSync*
  > *Potential ETH Loss Due to transfer Usage in Requestor Contract on `zkSync`*
- **L2 sequencer** — downtime and forced-inclusion delay windows against liquidations and oracle staleness.
  > *Inconsistent sequencer unexpected delay in DelayBuffer may harm users calling `forceInclusion()`*
- **Precompiles and gas** — availability differs per chain; hardcoded gas limits break where opcode pricing differs.
  > *BlsBn254 is not available in certain chains due to hardcoded gas limit*
- **Address identity** — the same address is a different entity on a different chain.
  > *Lost nfts due to smart wallets having different addresses on different chains*

## Also check

Upgradeability wiring: missing `__X_init()` calls, storage-gap changes, initializers left unprotected, and pattern mismatches. And re-check that previously-reported issues from earlier audits were actually fixed — he reports regressions as findings.
> *Issue #497 'Add parameter to lender accept bid for MaxMarketFee' from previous audit is still present*

## Every finding needs the named instance

"Does not handle fee-on-transfer tokens" is a LEAD. "USDT on mainnet reverts here because approve is called non-zero→non-zero at Line 214" is a finding. Name the token, the feed, the pool, or the chain.
