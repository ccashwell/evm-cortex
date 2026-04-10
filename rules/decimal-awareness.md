# Decimal Awareness

## The #1 "Where Did My Money Go" Bug
Token decimals vary. Assuming 18 decimals loses or creates money.

## Common Token Decimals
| Token | Decimals | Notes |
|-------|----------|-------|
| Most ERC-20 | 18 | ETH, WETH, DAI, LINK, UNI |
| USDC | 6 | Circle |
| USDT | 6 | Tether |
| WBTC | 8 | Wrapped Bitcoin |
| GUSD | 2 | Gemini Dollar |

## Rules
1. NEVER hardcode `1e18` for token amounts — always use `10 ** token.decimals()`
2. ALWAYS query `decimals()` at initialization and store as immutable
3. When converting between tokens with different decimals, use explicit scaling
4. When displaying USD values, account for price feed decimals (Chainlink: usually 8)

## Scaling Pattern
```solidity
// Converting between tokens with different decimals
function _normalize(uint256 amount, uint8 fromDecimals, uint8 toDecimals)
    internal pure returns (uint256)
{
    if (fromDecimals == toDecimals) return amount;
    if (fromDecimals > toDecimals) {
        return amount / 10 ** (fromDecimals - toDecimals);
    }
    return amount * 10 ** (toDecimals - fromDecimals);
}
```

## Chainlink Price Feed Decimals
- ETH/USD: 8 decimals
- BTC/USD: 8 decimals
- Token prices against ETH: 18 decimals
- Always check: `priceFeed.decimals()`

## Price Calculation
```solidity
// Token value in USD (18 decimal precision)
uint256 valueUSD = (amount * uint256(price) * 1e18)
    / (10 ** tokenDecimals * 10 ** priceDecimals);
```

## Testing
Always test with tokens of different decimal counts (6, 8, 18).
