# Finding Validation

Every finding passes four sequential gates. Fail any gate → **rejected** or **demoted** to lead. Later gates are not evaluated for failed findings.

You are not defending the code. The job of these gates is to verify the attacker's claimed exploit actually fires end-to-end — anything that interrupts the attack between the attacker's call and the harm means the agent's claim does not execute, and only then does it fail to qualify as a finding.

## Gate 1 — Attack execution

Trace the agent's claimed attack path from caller to harm. Read every guard, check, modifier, and constraint that sits on that path. Confirm that none of them interrupts the attack before the exploit step fires.
- A specific guard / check / modifier on the attack path interrupts the claimed exploit step before harm occurs (quote the exact line and trace it) → **REJECTED** (or **DEMOTE** if a related code smell remains)
- The supposed interruption is speculative ("probably wouldn't happen", "the caller would notice", "the deployer would set X") → **clears**, continue

## Gate 2 — Reachability

Prove the vulnerable state exists in a live deployment.

- Structurally impossible (enforced invariant prevents it) → **REJECTED**
- Requires privileged actions outside normal operation → **DEMOTE**
- Achievable through normal usage or common token behaviors → **clears**, continue

## Gate 3 — Trigger

Prove an unprivileged actor executes the attack.

- Only trusted roles can trigger → **DEMOTE**
- Unprivileged actor triggers profitably → **clears**, continue

**Admin-action findings — reject unless an unprivileged amplifier is named.** This applies ONLY to actions performed by admin/owner, NOT to unprivileged attacker actions. If the harm requires the admin acting maliciously or against documented intent, **REJECT** — do not even emit as a LEAD (stricter than the DEMOTE above). The finding clears only when the body names a concrete unprivileged amplifier:

- **race** — admin sets X mid-flow; an unprivileged user exploits the window before the update propagates.
- **retroactive sweep** — an admin update rewrites a pending value already credited.
- **asymmetric formula** — admin output chains into a formula an unprivileged actor profits from.
- **access gap** — missing guard, tautological auth, or missing init guard (the access mechanism itself is the bug).

No amplifier named → **REJECTED**. Amplifier named → judge it on that unprivileged path.

## Gate 4 — Impact

Prove material harm to an identifiable victim.

- Self-harm only → **REJECTED**
- Dust-level, no compounding → **DEMOTE**
- Material loss to identifiable victim → **CONFIRMED**

## Confidence

Start at **100**, deduct: partial attack path **-20**, bounded non-compounding impact **-15**, requires specific (but achievable) state **-10**. Confidence ≥ 80 gets description + fix. Below 80 gets description only.

## Safe patterns (do not flag)

- `unchecked` in 0.8+ (but verify the reasoning is correct)
- Explicit narrowing casts in 0.8+ (reverts on overflow)
- MINIMUM_LIQUIDITY burn on first deposit
- SafeERC20 (`safeTransfer`/`safeTransferFrom`)
- `nonReentrant` (only flag cross-contract attacks)
- Two-step admin transfer
- Consistent protocol-favoring rounding unless compounding or zero-rounding

## Lead promotion

Before finalizing leads, promote where warranted:

- **Cross-contract echo.** Same root cause confirmed as FINDING in one contract → promote in every contract where the identical pattern appears.
- **Multi-agent convergence.** 2+ agents flagged same area, lead was demoted (not rejected) → promote to FINDING at confidence 75.
- **Partial-path completion.** Only weakness is incomplete trace but path is reachable and unguarded → promote to FINDING at confidence 75, description only.

## Leads

High-signal trails for manual investigation. No confidence score, no fix — title, code smells, and what remains unverified.

## Do Not Report

Linter/compiler issues, gas micro-opts, naming, NatSpec. Admin privileges by design. Missing events. Centralization without exploit path. Implausible preconditions (but fee-on-transfer, rebasing, blacklisting ARE plausible for contracts accepting arbitrary tokens).

---

## Severity classification (EVM Cortex addendum)

Upstream reports confidence only. EVM Cortex additionally requires a severity per the global severity matrix, because the repo's finding-output-format and PoC rules key off it. Confidence and severity answer different questions and are assigned independently: **confidence** is how sure you are the bug is real (it drives the gates and lead promotion above); **severity** is how much it costs if it is real (it drives report ordering and remediation priority).

| Severity | Impact | Likelihood | Examples |
|----------|--------|------------|----------|
| **Critical** | Direct fund loss, protocol insolvency, permanent bricking | Highly likely, low barrier | Unrestricted `withdraw`, oracle manipulation draining the pool, infinite mint |
| **High** | Significant fund loss (>1% TVL) or protocol disruption | Likely under realistic conditions | Reentrancy draining partial funds, incorrect liquidation thresholds |
| **Medium** | Limited fund loss or degraded functionality | Possible under specific conditions | Rounding errors accumulating over time, griefing specific users |
| **Low** | Minimal, largely theoretical impact | Unlikely or heavily preconditioned | Front-running informational transactions |
| **Informational** | No direct security impact | N/A — best practice | Missing NatSpec, unused imports |

Rules: severity is impact × likelihood. Critical impact whose likelihood requires admin compromise is High, not Critical. Low impact with near-certain likelihood is Medium. Fund loss trumps other impact categories. When in doubt err higher — the protocol team can downgrade.

Note the interaction with Gate 3: an admin-action finding that clears only via a named unprivileged amplifier is severity-rated **on that unprivileged path**, not on the admin action.

### PoC requirements

| Severity | PoC |
|----------|-----|
| Critical | Working Foundry PoC — mandatory |
| High | Working Foundry PoC — mandatory |
| Medium | PoC or clear step-by-step reproduction |
| Low / Informational | Description only |

Route PoC construction to `security-verifier` or `poc-writer`. Pin the fork block number in every fork-based PoC so it stays reproducible.

### Fix verification (confidence ≥ 80)

Trace the proposed fix against the original attack path and confirm the path terminates, then check for side effects:

- [ ] Does not introduce a new DoS vector
- [ ] Does not break existing functionality
- [ ] Does not introduce a new reentrancy path
- [ ] Does not break an invariant identified by the invariant agent
- [ ] Uses safe patterns (`SafeERC20`, `nonReentrant`, checks-effects-interactions)

Then pattern-check the rest of the codebase for the same defect — a fix applied in one place is only half the work:

```bash
rg "\.safeTransfer\(|\.transfer\(|\.call\{" src/ --glob "*.sol"
```

Do NOT re-read source to "verify the most critical claim" once the gates have run. The agents traced it and dedup filtered it; re-verification rarely changes verdicts and costs real time.
