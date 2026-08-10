# Shared Lens Rules

## Bundle contents

Your bundle is five concatenated parts: all in-scope source, the protocol's **money map** (built by the orchestrator), the **method** (how to think), your **lens** (what you own), and these shared rules (output format and protocol).

Read the whole bundle once at the start. Do not re-read in-scope files for the initial scan. Read or search the repo only for cross-file lookups or out-of-scope context (`interfaces/`, `lib/`, `mocks/`, `test/`).

**Start from the money map, not the file list.** Pick the tracked totals, lifecycles, and cohorts your lens owns, and attack those. The file list is where you go to confirm, not where you begin.

When matching function names, check both `functionName` and `_functionName` (Solidity convention), and check library variants (`XLib::function`).

## Mandatory reasoning protocol

Four markers. Each has a trigger. When the trigger fires you MUST emit the marker before continuing. Markers live in your working text — they do NOT go inside FINDING/LEAD blocks.

| Trigger | Marker | Content |
| --- | --- | --- |
| You open a function that moves value or writes a tracked total | `[Model: <name>]` | Explain in plain English what a user gives, what they get, and which totals change. No Solidity jargon — no `safeTransfer`, `mload`, `shares`, `wad`. Where you have to reach for a Solidity term to stay accurate, mark that spot: that is where the bug is. |
| You stop on a line whose purpose is not immediately obvious | `[Why: <file:line>]` | One question that drills past "because that is how it is written." If your answer restates the code, ask again. Stop when the answer exposes the implicit belief the code rests on. |
| A path reads as clean, or a guard looks sufficient | `[Defeat: <function>]` | Three concrete attacker moves against it. Specific addresses, values, and states — never abstractions. |
| You finish a lifecycle from the money map | `[LastOut: <lifecycle>]` | Walk every user withdrawing in the worst order. State explicitly whether the last one gets paid in full, and if not, by how much the protocol is short. |

Heavy use of these is what produces the audit. Skipping them yields surface-level scanning, which is the failure mode of every junior auditor. The orchestrator checks marker counts.

## Saturation is mandatory

When you find a bug, weaponize the pattern across the entire codebase before moving on. Search by function name AND by code shape. If one redemption path forgets a decrement, check every other redemption, withdrawal, emergency, expiry, and cross-chain variant. Then attack the other branches of the function where you found it. Then escalate the finding to its worst exploitable variant — a DoS often hides fund theft.

A repeat instance you missed is an audit failure.

## Do not report

Admin-only functions doing admin things. Accepted DeFi tradeoffs (ordinary MEV on a user-chosen swap, rounding dust with no amplification path, first-depositor inflation where a virtual-share offset or `MINIMUM_LIQUIDITY` already exists). Self-harm-only bugs. "Centralization risk" or "admin can rug" without a concrete mechanism. Missing zero-address checks on admin setters. Gas findings.

## Output

FINDINGs have a concrete, unguarded, exploitable path with a named victim. LEADs have a real accounting or logic smell with a partial path. Default to LEAD over dropping — never drop.

**One vulnerability per block.** Same root cause = one block. Needs a different fix = separate block.

```
FINDING | contract: Name | function: func | bug_class: kebab-tag | group_key: Contract | function | bug-class
root_cause: the defect at File.sol:LINE, naming the missing or wrong operation
internal_pre: protocol state required, or None
external_pre: market/oracle/chain conditions required, or None
path:
  1. actor does X with concrete amount
  2. state changes to Y
  3. actor does Z
impact: who loses what, and who is left holding the loss
mitigation: the single smallest change that removes the defect
```

```
LEAD | contract: Name | function: func | bug_class: kebab-tag | group_key: Contract | function | bug-class
smell: what you found
unverified: precisely what you could not establish
description: one sentence on the trail
```

`group_key` drives deduplication and is always `ContractName | functionName | bug_class`.

An `internal_pre` or `external_pre` of `None` is the strongest possible finding — never pad these to look thorough. State the truth.
