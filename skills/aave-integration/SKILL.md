---
name: aave-integration
description: Use when integrating with Aave V3 for lending, borrowing, flash loans, or building on top of Aave markets. Covers Pool interactions, aToken mechanics, flash loans, eMode, isolation mode, and safe integration patterns.
---

# Aave V3 Integration Patterns

## Core Contracts

| Contract | Purpose |
|----------|---------|
| `Pool` | Entry point for supply, borrow, repay, withdraw, flash loans |
| `PoolAddressesProvider` | Registry for Pool and related contracts |
| `AToken` | Yield-bearing receipt token (rebasing balance) |
| `VariableDebtToken` | Tracks variable-rate debt |
| `StableDebtToken` | Tracks stable-rate debt (deprecated in most markets) |
| `PriceOracle` | Asset price feed aggregator |

## Supply / Withdraw

```solidity
import {IPool} from "@aave/v3-core/contracts/interfaces/IPool.sol";

IPool pool = IPool(addressesProvider.getPool());

// Supply: approve first, then supply
IERC20(asset).approve(address(pool), amount);
pool.supply(asset, amount, onBehalfOf, referralCode);

// Withdraw: burns aTokens, returns underlying
pool.withdraw(asset, amount, to);
// Use type(uint256).max to withdraw entire balance
```

## Borrow / Repay

```solidity
// Borrow: must have sufficient collateral
// interestRateMode: 1 = stable (deprecated), 2 = variable
pool.borrow(asset, amount, 2, referralCode, onBehalfOf);

// Repay: approve first
IERC20(asset).approve(address(pool), amount);
pool.repay(asset, amount, 2, onBehalfOf);
// Use type(uint256).max to repay full debt
```

## Flash Loans (0.05% Fee)

```solidity
import {IFlashLoanSimpleReceiver} from
    "@aave/v3-core/contracts/flashloan/base/FlashLoanSimpleReceiver.sol";

contract MyFlashLoan is FlashLoanSimpleReceiver {
    constructor(IPoolAddressesProvider provider)
        FlashLoanSimpleReceiver(provider) {}

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,   // 0.05% of amount
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "unauthorized");
        require(initiator == address(this), "untrusted initiator");

        // Your logic here — you have `amount` of `asset`
        _doArbitrage(asset, amount, params);

        // Repay: amount + premium
        uint256 amountOwed = amount + premium;
        IERC20(asset).approve(address(POOL), amountOwed);
        return true;
    }

    function requestFlashLoan(address asset, uint256 amount) external {
        POOL.flashLoanSimple(address(this), asset, amount, "", 0);
    }
}
```

## eMode (Efficiency Mode)

eMode allows higher LTV for correlated assets (e.g., stablecoins, ETH/stETH):

```solidity
// Set user's eMode category (0 = disabled)
pool.setUserEMode(1); // category 1 = stablecoins (typically 97% LTV)

// Query eMode config
DataTypes.EModeCategory memory config = pool.getEModeCategoryData(1);
// config.ltv, config.liquidationThreshold, config.liquidationBonus
```

## Health Factor Monitoring

```solidity
(
    uint256 totalCollateralBase,
    uint256 totalDebtBase,
    uint256 availableBorrowsBase,
    uint256 currentLiquidationThreshold,
    uint256 ltv,
    uint256 healthFactor
) = pool.getUserAccountData(user);

// healthFactor < 1e18 means liquidatable
// Monitor and trigger repay/add collateral when healthFactor < 1.1e18
```

## Safe Integration Pattern

```solidity
contract AaveIntegration {
    IPool public immutable pool;
    IPoolAddressesProvider public immutable addressesProvider;

    constructor(IPoolAddressesProvider _provider) {
        addressesProvider = _provider;
        pool = IPool(_provider.getPool());
    }

    function safeSupply(address asset, uint256 amount) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        IERC20(asset).approve(address(pool), amount);
        pool.supply(asset, amount, address(this), 0);
    }

    function safeWithdraw(address asset, uint256 amount, address to) external {
        pool.withdraw(asset, amount, to);
    }

    function getHealthFactor() external view returns (uint256) {
        (,,,,, uint256 hf) = pool.getUserAccountData(address(this));
        return hf;
    }
}
```

## Risk Parameters to Verify

Before integrating any asset on Aave:

- **LTV**: Maximum borrowing power of the collateral
- **Liquidation Threshold**: Health factor trigger for liquidation
- **Liquidation Bonus**: Discount liquidators receive (e.g., 5%)
- **Supply Cap**: Maximum total supply allowed
- **Borrow Cap**: Maximum total borrow allowed
- **Reserve Factor**: % of interest that goes to protocol treasury

## Checklist

- [ ] Use `PoolAddressesProvider` to resolve `Pool` address (never hardcode)
- [ ] Approve exact amounts before `supply()`/`repay()`
- [ ] Handle aToken rebasing — balance changes without transfers
- [ ] Check `getUserAccountData()` health factor after state changes
- [ ] Validate flash loan initiator is your own contract
- [ ] Account for the 0.05% flash loan premium in repayment
- [ ] Test against forked mainnet with real Aave deployment
- [ ] Verify supply/borrow caps haven't been reached before interacting
