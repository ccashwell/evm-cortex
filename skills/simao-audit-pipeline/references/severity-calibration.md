# Severity Calibration & Judging Gates

Run every deduplicated finding through the gates in order. Do not skip, do not reorder, do not revisit a gate after committing a verdict. Verdicts are one line each: `BLOCKS` / `ALLOWS` / `IRRELEVANT` / `UNCERTAIN`. **`UNCERTAIN` counts as `ALLOWS`** — an unproven guard is not a guard.

## Gate 1 — Does a code path actually stop this?

Walk the real execution path from the entry point to the impact. Every `require`, `modifier`, `if`, and downstream check gets a verdict. One `BLOCKS` on the critical path kills the finding — reject it, do not demote it.

Common false-positive killers, check each explicitly:
- a `nonReentrant` modifier the finding assumed absent
- a bound already enforced upstream by the caller
- Solidity ≥0.8 overflow reverts making the "overflow" impossible
- a virtual-share offset or `MINIMUM_LIQUIDITY` already handling inflation
- the value being pulled from storage, not the manipulable source assumed

## Gate 2 — Can an attacker reach the preconditions?

Take `internal_pre` and `external_pre` at face value and ask what it costs to create each.

Reachable at low or zero cost: `ALLOWS`. Requires an already-compromised privileged key, or a market condition with no realistic path: `BLOCKS`. Requires capital: `ALLOWS` if flash-loanable, otherwise weigh capital against profit.

A finding with `internal_pre: None` and `external_pre: None` clears this gate automatically and should be ranked above its peers.

## Gate 3 — Is the harm to someone other than the attacker?

Self-harm-only is not a finding. Neither is "user passes bad parameters and loses their own money," unless the protocol's own function is what supplies the bad parameter.

Name the victim class explicitly: other depositors, the last withdrawer, LPs, borrowers, the protocol treasury, the insurance fund. If you cannot name one, reject.

## Gate 4 — Is the impact real value, or theatre?

Real: funds stolen, funds permanently stuck, insolvency, bad debt accrual, liquidations blocked, core function permanently unusable, rewards misallocated between cohorts.

Not real: gas inefficiency, dust with no amplification path, "could be confusing," missing events, admin setter missing a zero-address check, standard MEV on a swap the user themselves chose.

## Severity assignment

Apply after all four gates pass.

**High** — direct loss of funds, or loss requiring only conditions an attacker can create.
- theft of funds belonging to others
- protocol insolvency; users cannot be made whole
- funds permanently locked with no recovery path
- an accounting desync that lets early actors over-withdraw and leaves the last user short
- liquidations permanently blocked, so bad debt accrues without bound
- anyone can seize a privileged position or an unowned claim

**Medium** — loss or breakage that needs a specific state, an external condition, or bounded time; or value misallocated between parties without draining the protocol.
- loss requiring an unusual-but-reachable protocol state (expiry, full utilization, paused asset, zero supply)
- temporary DoS on withdrawals or a core function
- rewards or fees distributed to the wrong cohort without protocol insolvency
- a documented behavior that does not hold, with real consequences
- griefing at meaningful attacker cost
- an integration that fails for a specific named token or chain

**Low** — real defect, minimal or highly constrained impact. Dust-scale losses, unreachable-in-practice reverts, missing input validation with contained blast radius.

**Info** — correctness, consistency, or robustness with no exploit path. Include these; his real reports carry many, and they are what protocol teams value in a private engagement.

## Calibration checks

- **Do not inflate a DoS to High** unless funds are stuck permanently, or the block prevents liquidations. Temporary withdrawal delay is Medium.
- **Do not deflate an accounting desync to Low** because the per-transaction amount is small. If it is repeatable or compounds, it is a drain — state the loop and rate it accordingly.
- **A rounding error is only Low if it cannot be looped.** Check that first, always.
- **Judge what the code allows, never what the deployer intends.** "The admin would not do that" is not a mitigation. Equally, "admin can rug" with no named unbounded parameter is not a finding.
- **When genuinely torn between two severities, choose the lower and say why in one line.** Over-claiming costs credibility, and credibility is the whole product.
