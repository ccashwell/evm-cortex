# Upgrade Safety Rules

## Storage Layout Rules
1. NEVER remove or reorder existing storage variables
2. NEVER change the type of existing storage variables
3. ONLY append new variables at the end
4. Use `__gap` slots to reserve space for future variables:
   ```solidity
   uint256[50] private __gap;
   ```
5. When adding variables, reduce `__gap` size by the same number of slots

## Initializer Rules
1. Use `initializer` modifier on initialization functions (not constructors)
2. Call `_disableInitializers()` in the constructor of implementation contracts:
   ```solidity
   /// @custom:oz-upgrades-unsafe-allow constructor
   constructor() {
       _disableInitializers();
   }
   ```
3. Always call parent initializers (`__ERC20_init`, `__Ownable_init`, etc.)
4. Never leave initializer functions unprotected

## Upgrade Checklist
- [ ] `forge inspect ContractV2 storage-layout` matches V1 layout
- [ ] No storage variable removals or reorderings
- [ ] `__gap` reduced correctly for new variables
- [ ] `_disableInitializers()` in implementation constructor
- [ ] New initializer function is `reinitializer(N)` (not `initializer`)
- [ ] `_authorizeUpgrade` has proper access control (UUPS)
- [ ] Upgrade tested on fork against live proxy
- [ ] No `selfdestruct` in implementation

## Proxy-Specific Rules
### UUPS
- Implementation MUST include `_authorizeUpgrade` with access control
- If `_authorizeUpgrade` is missing or unprotected, anyone can upgrade

### Transparent
- Admin cannot call implementation functions (selector clashing protection)
- ProxyAdmin contract owns the proxy

### Beacon
- All proxies sharing a beacon upgrade simultaneously
- Test with ALL proxy instances, not just one

## Verification Command
```bash
forge inspect ContractV1 storage-layout > layout-v1.json
forge inspect ContractV2 storage-layout > layout-v2.json
diff layout-v1.json layout-v2.json
```
