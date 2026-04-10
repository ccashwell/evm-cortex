# Test Before Deploy

## Mandatory Pre-Deployment Checklist

### Build
```bash
forge build --force  # Clean build, no cache
```
Must compile with zero warnings.

### Tests
```bash
forge test --gas-report
```
All tests must pass. No skipped tests on critical paths.

### Gas Snapshots
```bash
forge snapshot --check
```
No unexpected gas regressions from baseline.

### Static Analysis
```bash
slither . --filter-paths "test/,script/,lib/"
```
No High or Medium findings. All findings must be triaged.

### Coverage
```bash
forge coverage
```
Target: 90%+ line coverage on src/ contracts. 100% on security-critical paths.

### Storage Layout (if upgradeable)
```bash
forge inspect Contract storage-layout
```
Must match previous deployment layout.

### Deployment Dry Run
```bash
forge script script/Deploy.s.sol --rpc-url $RPC_URL
```
Simulate without broadcasting. Verify all transactions look correct.

### Post-Deployment Verification
```bash
# Verify contract is deployed
cast code <address> --rpc-url $RPC_URL

# Verify it responds correctly
cast call <address> "owner()(address)" --rpc-url $RPC_URL

# Verify on block explorer
forge verify-contract <address> Contract --chain-id <id>
```

### Post-Deployment Monitoring
- Watch events for unexpected activity
- Verify initial state is correct
- Test basic operations (deposit, withdraw, transfer)
- Monitor for unusual gas consumption patterns
