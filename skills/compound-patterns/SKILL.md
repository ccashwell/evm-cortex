---
name: compound-patterns
description: Use when integrating with Compound V3 (Comet) for lending, borrowing, or building liquidation bots. Covers single-asset lending, collateral management, absorb mechanics, and interest rate models.
---

# Compound V3 (Comet) Integration

## Architecture

Compound V3 (Comet) is a fundamentally different design from V2. Each Comet deployment is a single-asset market — one base asset (e.g., USDC) with multiple collateral assets. There are no cTokens; the Comet contract itself tracks balances.

| Component | Description |
|-----------|-------------|
| `Comet` | Core market contract (one per base asset) |
| `CometRewards` | Claims COMP rewards for suppliers/borrowers |
| `Configurator` | Governance-controlled parameter updates |
| `BulkerV2` | Batch operations including native ETH wrapping |

## Supply / Withdraw Base Asset

```solidity
import {IComet} from "./interfaces/IComet.sol";

IComet comet = IComet(COMET_USDC);

// Supply base asset (earn interest)
IERC20(usdc).approve(address(comet), amount);
comet.supply(usdc, amount);

// Withdraw base asset
comet.withdraw(usdc, amount);
// Use type(uint256).max for full withdrawal
```

## Collateral Management

```solidity
// Supply collateral (does NOT earn interest)
IERC20(weth).approve(address(comet), amount);
comet.supply(weth, amount);

// Withdraw collateral
comet.withdraw(weth, amount);

// Check collateral balance
uint256 collateral = comet.collateralBalanceOf(account, weth);
```

## Borrowing

```solidity
// Borrow base asset against collateral
// Simply withdraw more base than you supplied
comet.withdraw(usdc, borrowAmount);

// Repay borrow — supply base asset
IERC20(usdc).approve(address(comet), repayAmount);
comet.supply(usdc, repayAmount);
```

## Account State

```solidity
// Positive = supplying, negative = borrowing
int256 balance = comet.balanceOf(account);

// Check if account is liquidatable
bool isLiquidatable = comet.isLiquidatable(account);

// Get borrow balance (always positive)
uint256 borrowBalance = comet.borrowBalanceOf(account);

// Check if an action is allowed
bool canBorrow = comet.isBorrowCollateralized(account);
```

## Liquidation via Absorb

```solidity
// Compound V3 uses "absorb" instead of traditional liquidation
// Anyone can call absorb on an underwater account
address[] memory accounts = new address[](1);
accounts[0] = underwaterAccount;
comet.absorb(msg.sender, accounts);

// After absorb, protocol holds the collateral
// Buy collateral at a discount through the Comet contract
uint256 reserves = comet.getCollateralReserves(weth);
comet.buyCollateral(weth, minAmount, baseAmount, recipient);
```

## Interest Rate Model

Compound V3 uses a kinked rate model:

```
if utilization <= kink:
    borrowRate = baseBorrowRate + (utilization * borrowRateSlopeLow)
else:
    borrowRate = baseBorrowRate + (kink * borrowRateSlopeLow)
                 + ((utilization - kink) * borrowRateSlopeHigh)
```

```solidity
uint256 utilization = comet.getUtilization();
uint256 supplyRate = comet.getSupplyRate(utilization);
uint256 borrowRate = comet.getBorrowRate(utilization);
// Rates are per-second, scaled by 1e18
// APR = rate * SECONDS_PER_YEAR
```

## COMP Rewards

```solidity
import {ICometRewards} from "./interfaces/ICometRewards.sol";

ICometRewards rewards = ICometRewards(COMET_REWARDS);

// Claim COMP rewards
rewards.claim(cometAddress, account, true); // true = accrue first

// Check pending rewards
ICometRewards.RewardOwed memory owed = rewards.getRewardOwed(cometAddress, account);
// owed.token = COMP address, owed.owed = claimable amount
```

## Safe Integration Pattern

```solidity
contract CometIntegration {
    IComet public immutable comet;
    address public immutable baseToken;

    constructor(address _comet) {
        comet = IComet(_comet);
        baseToken = IComet(_comet).baseToken();
    }

    function supplyBase(uint256 amount) external {
        IERC20(baseToken).transferFrom(msg.sender, address(this), amount);
        IERC20(baseToken).approve(address(comet), amount);
        comet.supply(baseToken, amount);
    }

    function supplyCollateral(address asset, uint256 amount) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        IERC20(asset).approve(address(comet), amount);
        comet.supply(asset, amount);
    }

    function borrow(uint256 amount) external {
        comet.withdraw(baseToken, amount);
        IERC20(baseToken).transfer(msg.sender, amount);
    }

    function isHealthy() external view returns (bool) {
        return !comet.isLiquidatable(address(this));
    }
}
```

## Checklist

- [ ] Differentiate base asset operations (earn interest) from collateral (no interest)
- [ ] Use `isLiquidatable()` to monitor health before withdrawals
- [ ] Use `BulkerV2` for batching operations and native ETH support
- [ ] Approve exact amounts to Comet before supply
- [ ] Account for per-second interest accrual in balance checks
- [ ] Test absorb + buyCollateral flow for liquidation bots
- [ ] Check collateral factors and supply caps via `getAssetInfo()`
