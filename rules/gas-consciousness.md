# Gas Consciousness

## Principle
Every design decision must consider gas impact. Measure, don't guess. Use `forge snapshot` to track regressions.

## Current State (2026)
- Mainnet gas: under 1 gwei (verify: `cast base-fee`)
- ETH transfer: ~$0.004
- ERC-20 transfer: ~$0.01
- Swap: ~$0.04
- ERC-20 deploy: ~$0.24
- L2 swap: $0.002-0.003
- L2 transfer: $0.0003

## High-Impact Optimizations
1. **Storage packing** — pack variables into 32-byte slots
2. **calldata over memory** — for read-only function parameters
3. **Immutable/constant** — replaced inline at compile time (zero SLOAD)
4. **Custom errors** — cheaper than require strings
5. **Unchecked math** — where overflow is impossible
6. **Short-circuit evaluation** — cheap checks first in require chains
7. **Avoid redundant SLOADs** — cache storage reads in memory
8. **Batch operations** — amortize base cost over multiple operations

## EIP-2929 Awareness
- Cold SLOAD: 2100 gas (first access in transaction)
- Warm SLOAD: 100 gas (subsequent accesses)
- Cold SSTORE: 22,100 gas (first write)
- Cache storage reads when accessed multiple times

## When NOT to Optimize
- Readability is more important than marginal gas savings
- Admin functions (called rarely) do not need optimization
- Do not use assembly unless savings exceed 20% on a hot path
- Do not sacrifice security for gas savings

## Measurement
```bash
forge snapshot                  # Create baseline
# ... make changes ...
forge snapshot --check          # Compare against baseline
forge test --gas-report         # Detailed gas per function
```
