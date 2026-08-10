# The 0xSimao Method

Derived from 869 published findings across 143 reviews. This is HOW to think. Your lens file is WHAT to look for. Work them together.

## The core thesis

Most auditors read code looking for bad lines. That finds the bugs a linter finds.

0xSimao reads code looking for **a claim that has drifted from what actually backs it**. Value moves through a protocol in sequences: deposit, accrue, borrow, liquidate, withdraw. Each step writes some subset of the accounting state, and drift is any way that state stops describing reality:

| Drift | Shape |
| --- | --- |
| The write is missing | value moved and no variable recorded it — or one branch updates it and the sibling branch does not |
| The write is wrong | the variable is updated with the wrong amount, direction, rounding, units, or decimals |
| The write is mistimed | the right value at the wrong moment, so someone's snapshot is taken against state that is about to change |
| The write goes to the wrong party | the total is intact; the split between cohorts is not |
| The input was never trustworthy | the number is faithfully propagated from an oracle, a live balance, or a caller-supplied parameter an attacker controls |
| The state is unreachable | the accounting is correct but a revert, a pause, an unbounded loop, or a missing path means it can never be settled |

The drift is invisible at any single line. It only appears when you ask: *after this whole sequence, does the protocol still owe exactly what it holds — and can everyone actually collect it?*

A defect nobody can be shown to lose money from is a curiosity. So every candidate gets one more question, and it is the one that separates a finding from a smell:

> **Who is left holding the loss?**

Answer with a named class of actor, never "users". For accounting drift it is often whoever withdraws last, because a shortfall stays invisible until the balance runs out — but for a bricked liquidation it is the solvent lenders eating the bad debt, for a mistimed snapshot it is the cohort that held through the accrual, and for a forged signature it is whoever the forged message was drawn against. If the only person worse off is the caller, there is no finding.

**This lens is the sharpest one, not the only one.** Accounting drift is the largest single class in his corpus, but it is not the majority of it. The rest is DoS and permanently stuck funds, access control and signature defects, token- and integration-behaviour assumptions (`USDT` approvals, fee-on-transfer, blacklists, pausable collateral), oracle and parameter validation, and cross-chain state — and those are what your lens file owns. Work the money map first because it is what makes the drift class visible; then work your lens on its own terms. When the target has little accounting to speak of — a router, a registry, a verifier, a signature scheme — say so, keep the money map short, and go straight to your lens. Do not force a finding into the drift frame to make it sound like his.

## Phase 0 — Learn the protocol's own vocabulary before reading for bugs

His findings are written in the protocol's language: `cdsPoolValue`, `abond`, `downsideProtected`, `unassignedEarnings`, `raBalance`, `floatingBackupBorrowed`. He does not audit "a vault"; he audits *this* vault's specific accounting model.

Before hunting, be able to state in plain English:
- What does a user give, and what claim do they receive in return?
- What is that claim worth, and which variables determine the value?
- Where does yield come from, and who is entitled to it?
- What happens when the protocol is short — who absorbs the shortfall?

If you cannot answer these without Solidity jargon, you are not ready to find his class of bug. Any spot where your plain-English explanation goes fuzzy is exactly where the bug is; mark it and come back.

## Phase 1 — Build the money map

For every storage variable that claims to be an aggregate — `total*`, `*Supply`, `*Balance`, `*Deposited`, `*Locked`, `*Reserve`, `*Debt`, `*Accrued`, indices, cumulative rates — enumerate **every** function that writes it and whether that write increases or decreases it.

Then build the asymmetry table. Three columns of pure gold:

| Asymmetry | What to look for | Real finding |
| --- | --- | --- |
| Moved without tracking | value transferred out with no matching decrement | *"Users redeeming early will withdraw `Ra` without decreasing the amount locked, which will lead to stolen funds when withdrawing after expiry"* |
| Tracked in one branch only | `if` updates the total, `else` does not | *"Users will steal excess funds from the Vault due to `VaultPoolLib::redeem()` not always decreasing `raBalance` and `paBalance`"* |
| Never tracked at all | a balance is real but no variable represents it | *"Total `ETH`, `WETH` and `gameETH` are not tracked which will lead to insolvency"* |

Also flag every place a **live balance read** (`token.balanceOf(address(this))`, `address(this).balance`) is used as an accounting source. That is a donation attack or a cross-user theft waiting to happen — *"`ManagedLeveragedVault::openDen()` using all `asset()` balance"*, *"SDAIPriceFeed is vulnerable to donation attack via manipulatable vault rate"*.

## Phase 2 — Write the invariants down

5–15 statements that must always hold. Concretely, not vaguely:

- `Σ(all user withdrawable) <= actual token balance` — the solvency invariant, his single most productive one
- `totalX == Σ userX` for every aggregate with a per-user counterpart
- every credited unit is debited exactly once, in exactly one place
- monotonic things (indices, cumulative rates, timestamps) never go backwards and cannot be advanced for free
- a user's claim cannot increase from an action that costs them nothing
- state on chain A and chain B agree after every message settles

An invariant you can state and then break with a sequence is a finding. An invariant the docs assert and the code does not enforce is his highest-yield source of all.

## Phase 3 — Run the lifecycles, not the functions

Do not audit function by function. Audit *sequences*, and after each step write down which accounting variables changed and which should have.

Canonical sequences to run:

1. deposit → accrue yield → withdraw
2. deposit → borrow → price moves → liquidate → withdraw
3. stake → rewards distributed → unstake → claim
4. deposit → withdraw → deposit again (re-entry into the same accounting slot — *"Borrower deposit, withdraw, deposit will reinit `omniChainData.cdsPoolValue`"*)
5. open → adjust position → close (does the adjust path keep every invariant the open path established? — *"The health of a `ProtectedListing` is incorrectly calculated if `tokenTaken` has been changed through `adjustPosition()`"*)
6. source chain send → destination chain receive → failure/retry
7. the same sequence at expiry / after maturity / after the vault has ended

For each, ask at every step: **what did we just change that something else still assumes the old value of?**

## Phase 4 — Attack across cohorts and across time

This is the most distinctive part of his method, and the least commonly imitated.

Value in DeFi is split pro-rata among a changing set of holders. Any calculation that uses a *current* total to distribute a *historically accumulated* amount lets someone join late and take a share of value they did not earn.

Three questions, applied to every distribution, reward, fee, yield, and profit path:

1. **Can I join immediately before a distribution and take a share of it?**
   *"Immediately start getting rewards belonging to others after staking"*, *"Late abond holders steal USDa amount from liquidations from earlier abond holders"*, *"increaseNetworkTotal() allows big arbitrage opportunities by depositing before an increase transaction"*
2. **Can I leave immediately before a loss and push it onto whoever stays?**
   *"Borrower withdrawing at a loss will cause losses for cds depositors that only withdraw after the price recovers"*
3. **The Last User Out test.** Have every user withdraw, in sequence, in the worst order. Does the last one get paid? If the protocol is short by even dust, the money map has a leak upstream — go find it.
   *"`totalEarnings` is incorrect when withdrawing after ending which will withdraw too many funds leaving the `Vault` insolvent"*

Cumulative-rate and index-based accounting deserves special hostility: check whether the index can be advanced without cost (*"Malicious user can call `calculateCumulativeRate()` any number of times to inflate debt rate as `lastEventTime` is not updated"*), and whether a user's snapshot is taken at the right moment (*"Depositing to another receiver other than `msg.sender` will lead to stuck funds by increasing `avgStart` without claiming"*).

## Phase 5 — Saturate the subsystem

When you find one bug, **do not move on**. His reports cluster: 38 findings in one protocol, most in a single accounting subsystem. That is not luck. Once the accounting model is in your head, mine it out.

After every finding:
1. Search the codebase for every other site with the same code shape — by function name *and* by pattern. If `redeem()` forgets a decrement, check `withdraw()`, `emergencyWithdraw()`, `redeemExpired()`, and the cross-chain variant.
2. Attack the other branches of the function where you found it.
3. Escalate: a DoS often conceals fund theft; a rounding error often compounds into drain. Push each finding to its worst exploitable variant before writing it up.

A repeat instance you missed is an audit failure, not an omission.

## Phase 6 — Prove it, with preconditions stated honestly

His writeups make the reader's job trivial by separating what the protocol must look like from what the world must look like:

- **Internal pre-conditions** — protocol state required (a maturity exists, a position is near liquidation, deposits are non-zero). "None" is common and is the strongest possible case.
- **External pre-conditions** — market/oracle/chain conditions required (price moves X%, sequencer down, gas above Y). "None" is again the strongest case.
- **Attack path** — numbered, concrete, with actors and numbers. Not "an attacker could manipulate the rate" but "1. User deposits 100e18. 2. User is liquidated via `liquidationType1()`, adding 5e18 USDa. 3. Attacker deposits via flashloan and withdraws, taking 4.9e18 of it."
- **Impact** — who loses what. Name the victim class.

If you cannot fill the attack path with real numbers, you have a LEAD. Say so. A well-described lead is worth more than a finding you inflated.

## Phase 7 — Minimal mitigation

One change, the smallest that removes the defect, stated in the protocol's own terms:

- "Add a cumulative tracking variable to handle this case."
- "Set the vesting interest to 0 when the new interest is 0."
- "Decrease `raBalance` in the early-redemption branch as well."
- "Use `mulDiv` when converting between token and share amounts."

Not "refactor the accounting system." Not "consider adding validation." Name the operation to add, remove, or reorder.

## Three habits that separate his findings from noise

**Root cause is a missing operation at a named line.** Very often the bug is not a wrong line but an absent one. Write it that way: *"In `PsmLib.sol:125`, `self.psm.balances.ra.decLocked(amount)` is not called."* Pointing at the absence is what makes the fix obvious.

**Judge what the code allows, never what the deployer intends.** "The admin wouldn't do that" is not a mitigation. But equally, "admin can rug" with no concrete mechanism is not a finding.

**Doubt the clean-looking path hardest.** The functions that read as obviously correct are the ones everyone else also skipped. When a guard looks sufficient, name three specific ways to defeat it — with addresses, values, and states, not abstractions — before you accept it.

## Do not report

Admin-only functions doing admin things. Standard, accepted DeFi tradeoffs (ordinary MEV on a swap the user chose, rounding dust with no amplification, first-depositor inflation where `MINIMUM_LIQUIDITY` or a virtual-share offset is already present). Self-harm-only bugs. "Centralization risk" with no mechanism. Gas optimizations dressed as vulnerabilities. Missing zero-address checks on admin setters.
