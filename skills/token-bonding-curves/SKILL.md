---
name: token-bonding-curves
description: Use when implementing bonding curve token sales, automated market makers with supply-dependent pricing, or continuous token models. Covers linear, polynomial, logarithmic, and Bancor-style curves.
---

# Token Bonding Curves

## Concept

A bonding curve is a mathematical function that defines the price of a token as a function of its supply. As supply increases, price increases along the curve. Tokens are minted on buy and burned on sell, with a reserve backing the curve.

```
price = f(supply)
cost_to_buy(n) = integral(f, supply, supply + n)
proceeds_from_sell(n) = integral(f, supply - n, supply)
```

## Curve Types

| Curve | Formula | Behavior |
|-------|---------|----------|
| Linear | `price = m * supply + b` | Steady price increase |
| Polynomial | `price = a * supply^n` | Accelerating increase (n>1) |
| Logarithmic | `price = a * ln(supply) + b` | Decelerating increase |
| Sigmoid | `price = a / (1 + e^(-k*(supply-mid)))` | S-curve with plateau |
| Bancor | `price = reserve / (supply * CW)` | Connector weight model |

## Linear Bonding Curve Implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LinearBondingCurve is ERC20, ReentrancyGuard {
    uint256 public immutable slope;      // price increase per token (in wei per token)
    uint256 public immutable basePrice;  // starting price (in wei per token)
    uint256 public reserveBalance;

    constructor(uint256 _slope, uint256 _basePrice)
        ERC20("BondingToken", "BOND")
    {
        slope = _slope;
        basePrice = _basePrice;
    }

    /// @notice Price at a given supply level
    function priceAtSupply(uint256 supply) public view returns (uint256) {
        return basePrice + (slope * supply / 1e18);
    }

    /// @notice Cost to buy `amount` tokens at current supply
    /// @dev Integral of linear function: base*amount + slope*(s1^2 - s0^2) / (2 * 1e18)
    function getBuyCost(uint256 amount) public view returns (uint256) {
        uint256 s0 = totalSupply();
        uint256 s1 = s0 + amount;
        uint256 baseCost = basePrice * amount / 1e18;
        uint256 slopeCost = slope * (s1 * s1 - s0 * s0) / (2 * 1e36);
        return baseCost + slopeCost;
    }

    /// @notice Proceeds from selling `amount` tokens at current supply
    function getSellProceeds(uint256 amount) public view returns (uint256) {
        uint256 s0 = totalSupply();
        require(amount <= s0, "exceeds supply");
        uint256 s1 = s0 - amount;
        uint256 baseCost = basePrice * amount / 1e18;
        uint256 slopeCost = slope * (s0 * s0 - s1 * s1) / (2 * 1e36);
        return baseCost + slopeCost;
    }

    function buy(uint256 minTokens) external payable nonReentrant {
        uint256 cost = getBuyCost(minTokens);
        require(msg.value >= cost, "insufficient payment");

        reserveBalance += cost;
        _mint(msg.sender, minTokens);

        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "refund failed");
        }

        emit Buy(msg.sender, minTokens, cost);
    }

    function sell(uint256 amount) external nonReentrant {
        require(balanceOf(msg.sender) >= amount, "insufficient balance");

        uint256 proceeds = getSellProceeds(amount);
        require(proceeds <= reserveBalance, "insufficient reserve");

        reserveBalance -= proceeds;
        _burn(msg.sender, amount);

        (bool ok, ) = msg.sender.call{value: proceeds}("");
        require(ok, "transfer failed");

        emit Sell(msg.sender, amount, proceeds);
    }

    event Buy(address indexed buyer, uint256 amount, uint256 cost);
    event Sell(address indexed seller, uint256 amount, uint256 proceeds);

    receive() external payable {}
}
```

## Bancor Formula

The Bancor formula uses a Connector Weight (CW) to relate reserve balance, supply, and price:

```
price = reserveBalance / (supply * CW)
returnAmount = supply * ((1 + depositAmount / reserveBalance)^CW - 1)
```

```solidity
/// @notice Bancor buy calculation using exponentiation by Taylor series
/// @param supply Current token supply
/// @param reserveBalance Current reserve balance
/// @param reserveRatio Reserve ratio (CW) in PPM (1-1000000)
/// @param depositAmount ETH/token deposited
function calculatePurchaseReturn(
    uint256 supply,
    uint256 reserveBalance,
    uint32 reserveRatio,
    uint256 depositAmount
) public pure returns (uint256) {
    if (reserveRatio == 1000000) {
        // Special case: CW = 100% -> linear
        return supply * depositAmount / reserveBalance;
    }
    // For fractional CW, use Power function (fixed-point math library)
    // return supply * (power(1 + depositAmount/reserveBalance, CW) - 1)
}
```

## Polynomial Curve

```solidity
// price = coefficient * supply^exponent
// cost = integral = coefficient * (s1^(exp+1) - s0^(exp+1)) / (exp+1)
function getPolynomialCost(uint256 amount) public view returns (uint256) {
    uint256 s0 = totalSupply();
    uint256 s1 = s0 + amount;
    uint256 exp1 = exponent + 1;
    return coefficient * (power(s1, exp1) - power(s0, exp1)) / exp1;
}
```

## Buy/Sell Spread

Add a spread to capture value for the protocol:

```solidity
uint256 public constant SELL_FEE_BPS = 300; // 3% sell fee

function sell(uint256 amount) external {
    uint256 grossProceeds = getSellProceeds(amount);
    uint256 fee = grossProceeds * SELL_FEE_BPS / 10000;
    uint256 netProceeds = grossProceeds - fee;
    // fee stays in reserve, increasing price floor for remaining holders
}
```

## Checklist

- [ ] Reserve balance always covers the integral under the curve for all outstanding tokens
- [ ] Buy/sell functions use `nonReentrant` (ETH transfers create reentrancy risk)
- [ ] Price function is monotonically increasing with supply
- [ ] Integer math doesn't lose significant precision in curve calculations
- [ ] Consider overflow in `supply^n` calculations for polynomial curves
- [ ] Sell proceeds never exceed reserve balance
- [ ] Front-running mitigation: slippage tolerance or commit-reveal
- [ ] Test buy/sell round-trip: buy then immediately sell should have minimal loss (only spread)
- [ ] Test extreme values: very large buys, selling entire supply
