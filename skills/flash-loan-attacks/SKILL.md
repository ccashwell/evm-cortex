---
name: flash-loan-attacks
description: Flash loan attack vectors and defenses for DeFi protocols. Use when designing governance, oracles, AMMs, or any system where large capital can be borrowed atomically. Covers governance manipulation, oracle attacks, price impact, and liquidity pool exploits.
---

# Flash Loan Attacks

## What Makes Flash Loans Dangerous

Flash loans allow borrowing unlimited capital with zero collateral, provided it's returned within the same transaction. This means any attack that's **profitable with enough capital** becomes free to execute.

## Attack Pattern: Governance Manipulation

Borrow tokens → acquire voting power → pass malicious proposal → profit.

```
1. Flash borrow 10M governance tokens from Aave/dYdX
2. Delegate voting power to attacker
3. Create + vote on malicious proposal (if single-block voting)
4. Proposal executes: drain treasury / change parameters
5. Return flash loan
```

### Defense: Snapshot-Based Voting

```solidity
contract SafeGovernor {
    // Voting power is snapshotted at proposal creation block
    // Flash-borrowed tokens have no voting power for existing proposals
    function propose(...) external returns (uint256 proposalId) {
        uint256 snapshot = block.number; // or block.number - 1
        proposals[proposalId].snapshotBlock = snapshot;
        // ...
    }

    function castVote(uint256 proposalId, uint8 support) external {
        uint256 snapshot = proposals[proposalId].snapshotBlock;
        // Uses historical balance, not current
        uint256 weight = token.getPastVotes(msg.sender, snapshot);
        // ...
    }
}
```

Additional defenses:
- **Voting delay**: require N blocks between proposal creation and voting start
- **Time-weighted voting**: voting power based on average balance over time
- **Proposal threshold**: minimum token holding period to create proposals

## Attack Pattern: Oracle Manipulation

Borrow tokens → manipulate spot price → exploit protocol using stale/spot price.

```
1. Flash borrow large amount of token A
2. Swap token A → token B on a DEX, crashing A's spot price
3. Protocol reads spot price (or manipulable TWAP)
4. Borrow against token B using deflated A price as collateral
5. Swap back, restoring price
6. Return flash loan, keep profit
```

### Defense: TWAP Oracles

```solidity
// Use Uniswap V3 TWAP (multi-block) instead of spot price
function getTWAP(address pool, uint32 twapWindow) internal view returns (uint256) {
    uint32[] memory secondsAgos = new uint32[](2);
    secondsAgos[0] = twapWindow; // e.g., 1800 for 30 minutes
    secondsAgos[1] = 0;

    (int56[] memory tickCumulatives,) = IUniswapV3Pool(pool).observe(secondsAgos);

    int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
    int24 averageTick = int24(tickDelta / int56(int32(twapWindow)));

    return OracleLibrary.getQuoteAtTick(averageTick, baseAmount, baseToken, quoteToken);
}
```

Better: use Chainlink oracles with staleness checks (see oracle-manipulation skill).

## Attack Pattern: Liquidity Pool Manipulation

```
1. Flash borrow large amount of asset
2. Deposit into lending pool → inflate share price or available liquidity
3. Another protocol reads inflated state
4. Exploit the inflated reading (over-borrow, incorrect liquidation)
5. Withdraw from lending pool
6. Return flash loan
```

### Defense: Multi-Block Delay

```solidity
mapping(address => uint256) public lastDepositBlock;

function deposit(uint256 amount) external {
    lastDepositBlock[msg.sender] = block.number;
    // ...
}

function borrow(uint256 amount) external {
    // Cannot deposit and borrow in the same block
    if (lastDepositBlock[msg.sender] == block.number) {
        revert SameBlockBorrow();
    }
    // ...
}
```

## Attack Pattern: Price Impact Sandwich

```
1. Flash borrow tokens
2. Large swap moves price significantly
3. Target protocol executes at manipulated price
4. Swap back at a profit
5. Return flash loan
```

### Defense: Slippage Protection + Deadlines

```solidity
function swap(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOutMin,   // slippage protection
    uint256 deadline         // expiration
) external {
    if (block.timestamp > deadline) revert Expired();

    uint256 amountOut = _executeSwap(tokenIn, tokenOut, amountIn);

    if (amountOut < amountOutMin) revert SlippageExceeded(amountOut, amountOutMin);

    // ...
}
```

## Flash Loan Detection

You cannot reliably detect flash loans, but you can detect same-block operations.

```solidity
// Track last interaction block per user
mapping(address => uint256) private _lastBlock;

modifier noSameBlockAction() {
    if (_lastBlock[msg.sender] == block.number) revert SameBlockAction();
    _lastBlock[msg.sender] = block.number;
    _;
}
```

This prevents same-block deposit+borrow, deposit+withdraw, etc.

## Defense Summary

| Attack Vector | Defense |
|--------------|---------|
| Governance vote manipulation | Snapshot-based voting, voting delay |
| Spot price manipulation | TWAP oracles, Chainlink, multi-source |
| Liquidity inflation | Multi-block delay, deposit-borrow separation |
| Price impact sandwich | Slippage protection, deadline parameters |
| Share price manipulation | Virtual shares/assets (ERC-4626 inflation defense) |

## Flash Loan Defense Checklist

- [ ] No reliance on spot prices for critical calculations
- [ ] Governance uses snapshot-based voting with delay
- [ ] Oracles use TWAP or Chainlink (not spot prices)
- [ ] Deposit and borrow separated by at least 1 block
- [ ] Slippage protection on all swap operations
- [ ] Deadline parameters on time-sensitive operations
- [ ] Share price calculations resistant to first-depositor attacks
- [ ] Consider: can an attacker profit by temporarily moving any onchain state?
