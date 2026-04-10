---
name: flash-loan-usage
description: Use when implementing flash loan strategies including arbitrage, liquidation bots, collateral swaps, or debt refinancing. Covers Aave V3, Uniswap, and Balancer flash loan patterns with receiver templates.
---

# Flash Loan Patterns

## Flash Loan Providers

| Provider | Fee | Multi-Asset | Notes |
|----------|-----|-------------|-------|
| Aave V3 | 0.05% | Yes (`flashLoan`) | Most popular, widest asset support |
| Uniswap V2/V3 | 0.3% / pool fee | Yes (flash swap) | Built into swap, repay with other token |
| Uniswap V4 | 0% | Yes (flash accounting) | Enabled by PoolManager's delta-tracking which will always settle cleanly as long as the full delta is repaid within the unlock context. |
| Balancer V2 | 0% | Yes | Free, limited to Balancer vault assets |
| dYdX | 0% | Limited | Solo margin flash loans |

## Aave V3 Flash Loan Receiver

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlashLoanSimpleReceiverBase} from
    "@aave/v3-core/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from
    "@aave/v3-core/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AaveFlashLoan is FlashLoanSimpleReceiverBase {
    address public immutable owner;

    constructor(IPoolAddressesProvider provider)
        FlashLoanSimpleReceiverBase(provider)
    {
        owner = msg.sender;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "caller must be pool");
        require(initiator == address(this), "untrusted initiator");

        (uint8 action) = abi.decode(params, (uint8));

        if (action == 1) _arbitrage(asset, amount);
        else if (action == 2) _liquidate(asset, amount, params);
        else if (action == 3) _collateralSwap(asset, amount, params);

        uint256 repayment = amount + premium;
        IERC20(asset).approve(address(POOL), repayment);
        return true;
    }

    function execute(address asset, uint256 amount, bytes calldata params) external {
        require(msg.sender == owner, "only owner");
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    function _arbitrage(address asset, uint256 amount) internal {
        // Buy low on DEX A, sell high on DEX B
        // Profit must exceed the 0.05% premium
    }

    function _liquidate(address asset, uint256 amount, bytes calldata params) internal {
        // Use borrowed funds to liquidate an underwater position
        // Receive collateral at a discount, swap back to repay
    }

    function _collateralSwap(address asset, uint256 amount, bytes calldata params) internal {
        // Repay existing debt, withdraw old collateral
        // Swap to new collateral, deposit, re-borrow
    }
}
```

## Aave V3 Multi-Asset Flash Loan

```solidity
function executeMultiFlash(
    address[] calldata assets,
    uint256[] calldata amounts
) external {
    uint256[] memory modes = new uint256[](assets.length);
    // mode 0 = full repay, 1 = stable debt, 2 = variable debt
    POOL.flashLoan(
        address(this),
        assets,
        amounts,
        modes,
        address(this), // onBehalfOf
        "",            // params
        0              // referralCode
    );
}
```

## Uniswap V3 Flash Swap

```solidity
import {IUniswapV3FlashCallback} from
    "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol";

contract UniV3Flash is IUniswapV3FlashCallback {
    IUniswapV3Pool public immutable pool;

    function initFlash(uint256 amount0, uint256 amount1) external {
        pool.flash(address(this), amount0, amount1, abi.encode(msg.sender));
    }

    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        require(msg.sender == address(pool), "unauthorized");

        address caller = abi.decode(data, (address));
        // Use amount0 + amount1 here

        // Repay: principal + fee
        if (fee0 > 0) IERC20(pool.token0()).transfer(address(pool), amount0 + fee0);
        if (fee1 > 0) IERC20(pool.token1()).transfer(address(pool), amount1 + fee1);
    }
}
```

## Balancer V2 Flash Loan (Zero Fee)

```solidity
import {IFlashLoanRecipient} from
    "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import {IVault} from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

contract BalancerFlash is IFlashLoanRecipient {
    IVault public constant VAULT = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == address(VAULT), "unauthorized");

        // feeAmounts are 0 for Balancer
        // Your logic here

        for (uint256 i = 0; i < tokens.length; i++) {
            tokens[i].transfer(address(VAULT), amounts[i] + feeAmounts[i]);
        }
    }

    function execute(IERC20[] calldata tokens, uint256[] calldata amounts) external {
        VAULT.flashLoan(this, tokens, amounts, "");
    }
}
```

## Arbitrage Pattern

```
1. Flash borrow X tokens of asset A from Aave
2. Swap A -> B on DEX₁ (where A is cheap)
3. Swap B -> A on DEX₂ (where A is expensive)
4. Repay X + premium to Aave
5. Keep profit (A_out - X - premium)
```

Profit condition: `output - input - premium - gas > 0`

## Liquidation Bot Pattern

```
1. Monitor health factors via events or polling
2. Flash borrow the debt asset
3. Call liquidationCall() on Aave / absorb() on Compound
4. Receive discounted collateral
5. Swap collateral back to debt asset
6. Repay flash loan + premium
7. Keep liquidation bonus minus fees
```

## Checklist

- [ ] Always validate `msg.sender` is the lending pool in callbacks
- [ ] Validate `initiator` is your own contract (prevents griefing)
- [ ] Calculate profit after all fees (flash loan premium + swap fees + gas)
- [ ] Use Balancer for zero-fee flash loans when assets are available
- [ ] Approve exact repayment amount (principal + premium) before return
- [ ] Test with forked mainnet to verify real liquidity and pricing
- [ ] Add access control — only owner/keeper can trigger flash loans
- [ ] Handle the case where arbitrage is unprofitable (revert early)
