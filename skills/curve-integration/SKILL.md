---
name: curve-integration
description: Use when integrating with Curve Finance for stablecoin swaps, liquidity provision, or gauge-based reward systems. Covers StableSwap math, crypto pools, meta-pools, gauge voting, and safe swap patterns.
---

# Curve Finance Integration

## Pool Types

| Pool Type | Use Case | Math |
|-----------|----------|------|
| StableSwap | Pegged assets (USDC/USDT/DAI) | Hybrid constant-sum/constant-product |
| CryptoSwap | Volatile pairs (ETH/CRV) | Dynamic peg with internal oracle |
| Meta-pool | Pairs against 3pool LP (fraxBP) | Nested pool composition |
| Tricrypto | Three volatile assets | Generalized crypto invariant |

## StableSwap Amplification Parameter (A)

The invariant is a blend of constant-sum (A = infinity) and constant-product (A = 0):

```
A * n^n * sum(x_i) + D = A * D * n^n + D^(n+1) / (n^n * prod(x_i))
```

- Higher A: tighter peg, lower slippage near peg, catastrophic slippage far from peg
- Lower A: behaves more like Uniswap constant-product
- Typical A: 100-2000 for stablecoin pools

## Core Swap Interface

```solidity
interface ICurvePool {
    // Exchange tokens within the pool
    // i = input token index, j = output token index
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);

    // For ETH pools, send ETH as msg.value
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)
        external payable returns (uint256);

    // Get expected output (use for quoting, NOT as min_dy)
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);

    // Liquidity operations
    function add_liquidity(uint256[3] calldata amounts, uint256 min_mint_amount) external returns (uint256);
    function remove_liquidity(uint256 _amount, uint256[3] calldata min_amounts) external returns (uint256[3] memory);
    function remove_liquidity_one_coin(uint256 _amount, int128 i, uint256 min_amount) external returns (uint256);

    function get_virtual_price() external view returns (uint256);
    function A() external view returns (uint256);
    function balances(uint256 i) external view returns (uint256);
}
```

## Safe Swap Pattern

```solidity
contract CurveSwapper {
    ICurvePool public immutable pool;
    uint256 public constant MAX_SLIPPAGE_BPS = 50; // 0.5%

    constructor(address _pool) {
        pool = ICurvePool(_pool);
    }

    function swap(
        int128 tokenIn,
        int128 tokenOut,
        uint256 amountIn,
        address recipient
    ) external returns (uint256 amountOut) {
        IERC20(pool.coins(uint256(int256(tokenIn)))).transferFrom(
            msg.sender, address(this), amountIn
        );
        IERC20(pool.coins(uint256(int256(tokenIn)))).approve(address(pool), amountIn);

        uint256 expected = pool.get_dy(tokenIn, tokenOut, amountIn);
        uint256 minOut = expected * (10000 - MAX_SLIPPAGE_BPS) / 10000;

        amountOut = pool.exchange(tokenIn, tokenOut, amountIn, minOut);

        IERC20(pool.coins(uint256(int256(tokenOut)))).transfer(recipient, amountOut);
    }
}
```

## stETH/ETH Pool Integration

```solidity
// Curve stETH/ETH pool: 0xDC24316b9AE028F1497c275EB9192a3Ea0f67022
// Index 0 = ETH, Index 1 = stETH
ICurvePool stethPool = ICurvePool(0xDC24316b9AE028F1497c275EB9192a3Ea0f67022);

// Swap ETH -> stETH
uint256 minSteth = stethPool.get_dy(0, 1, msg.value) * 9950 / 10000;
uint256 received = stethPool.exchange{value: msg.value}(0, 1, msg.value, minSteth);

// Swap stETH -> ETH
IERC20(steth).approve(address(stethPool), amount);
uint256 ethReceived = stethPool.exchange(1, 0, amount, minEth);
```

## Gauge Voting and CRV Rewards

```solidity
interface ICurveGauge {
    function deposit(uint256 _value) external;
    function withdraw(uint256 _value) external;
    function claim_rewards() external;
    function claimable_reward(address _addr, address _token) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

// Deposit LP tokens into gauge to earn CRV
IERC20(lpToken).approve(address(gauge), amount);
gauge.deposit(amount);

// Claim CRV rewards
gauge.claim_rewards();
```

## Virtual Price and LP Valuation

`get_virtual_price()` returns the value of 1 LP token in terms of the pool's unit of account. It should only increase (manipulation-resistant).

```solidity
// LP value = lp_balance * virtual_price / 1e18
uint256 virtualPrice = pool.get_virtual_price();
uint256 lpValue = lpBalance * virtualPrice / 1e18;
```

**Warning**: Do NOT use `get_virtual_price()` as a price oracle for lending — it was exploitable via read-only reentrancy in older Vyper versions. Use Chainlink or Curve's dedicated oracle for that purpose.

## Checklist

- [ ] Use `get_dy()` for quoting but apply your own slippage tolerance for `min_dy`
- [ ] Handle ETH pools via `msg.value` (index 0 is typically native ETH)
- [ ] Verify token indices — they vary per pool deployment
- [ ] Never use `get_virtual_price()` as a lending oracle without reentrancy guards
- [ ] Deposit LP tokens into gauges for CRV emissions
- [ ] Check pool A parameter — low A pools have higher slippage
- [ ] Test against forked mainnet with real pool state
