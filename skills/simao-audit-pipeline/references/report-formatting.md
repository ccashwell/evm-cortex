# Report Formatting

Every finding has two sections: **Description** and **Mitigation**.

## Ordering and titles

Order findings High → Medium → Low → Info; within a severity, most severe impact first. Number as `H-1`, `M-1`, `L-1`, `I-1`.

**Titles carry the mechanism and the consequence.** His titles name the exact function, the specific wrong operation, and the resulting loss. Never write a vague title.

Good:
- `` `VaultPoolLib::redeem()` does not always decrease `raBalance`, letting users steal excess funds from the Vault ``
- `` `burnSharesToWithdrawEarnings` burns before math, causing the share value to increase ``
- `Late abond holders steal USDa amount from liquidations from earlier abond holders`

Bad: `Accounting issue in redeem`, `Reentrancy risk`, `Missing validation`.

Use backticks around every identifier and `Contract::function()` notation throughout.

## Finding format

````markdown
## M-1. Vesting interest is not reset to 0 in case there is no interest in `LoopedVault11::updateTotalAssets()`

**Description:**

`LoopedVault1_1::_updateTotalAssets()` does not set vesting interest to 0 when `vestingInterestPreFee` is null, so the new period vests with interest from the previous period. This is unlikely in practice given that some interest should always accrue.

**Recommended Mitigation:**

Set the vesting interest to 0 when the new interest is 0.
````

Rules:
- `Description` then `Recommended Mitigation`. One or two paragraphs each, terse — the defect and the fix, not a narrative.
- Link the exact line.
- State the practical likelihood honestly, including when it lowers the severity — that candor is the point.
- Mitigation is the smallest change; show a diff where the fix is a code edit.
- When the dedup pass preserved multiple distinct mitigations, present them as `**Recommended Mitigation (Option A — add-missing-write)**` / `**(Option B — reorder)**`, each verbatim.
- Leave a blank `**Fix review:**` line for the client response.

## Report header

Open every report with:

```markdown
# Security Review — <protocol name>

**Scope:** N files, M contracts
**Method:** accounting-first review across 12 attack lenses
**Findings:** X High · Y Medium · Z Low · W Info
```

Then a 3–6 sentence summary of the protocol's accounting model in plain English — what users give, what they receive, where yield comes from, and who absorbs shortfalls. This proves the review understood the protocol and is where a client's trust is won or lost.

If any lens flagged a systemic pattern (the same defect shape at several sites), add a short **Systemic observations** section after the summary, before the findings.

## Leads section

End with `## Unverified leads` listing every surviving LEAD as a one-liner: `Contract::function — smell — what could not be established`. Never silently drop them. Leads are calibration, and a client reads them as the map of where to look next.
