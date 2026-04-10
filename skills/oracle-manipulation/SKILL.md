---
name: oracle-manipulation
description: Oracle attack vectors and safe integration patterns for DeFi protocols. Use when integrating Chainlink, Uniswap TWAP, or any price oracle. Covers staleness checks, L2 sequencer downtime, sandwich oracle updates, and fallback strategies.
---

# Oracle Manipulation

## Spot Price Manipulation

Spot prices from DEXs (Uniswap V2 reserves, Curve pool balances) can be manipulated within a single transaction via flash loans.

```solidity
// VULNERABLE: reads instantaneous reserves
function getPrice(address pair) external view returns (uint256) {
    (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(pair).getReserves();
    return uint256(reserve1) * 1e18 / uint256(reserve0); // easily manipulated
}
```

**Never use spot prices for:**
- Collateral valuation
- Liquidation thresholds
- Governance decisions
- Any value-bearing calculation

## TWAP Oracle (Time-Weighted Average Price)

TWAPs average prices over a time window, making manipulation expensive (attacker must sustain the manipulated price across blocks).

```solidity
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

function getTWAP(
    address pool,
    address baseToken,
    address quoteToken,
    uint128 baseAmount,
    uint32 twapWindow
) internal view returns (uint256 quoteAmount) {
    if (twapWindow == 0) revert InvalidTwapWindow();

    (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, twapWindow);

    quoteAmount = OracleLibrary.getQuoteAtTick(
        arithmeticMeanTick,
        baseAmount,
        baseToken,
        quoteToken
    );
}
```

### TWAP Window Selection

| Window | Security | Latency | Use Case |
|--------|----------|---------|----------|
| 1 min | Low | Low | Not recommended |
| 10 min | Medium | Medium | Fast-moving markets with monitoring |
| 30 min | High | High | Lending protocols, collateral valuation |
| 24 hr | Very high | Very high | Governance, long-term averaging |

Shorter windows are cheaper to manipulate. For lending protocols, use 30+ minutes.

## Multi-Block TWAP Manipulation

Post-merge, a single validator can propose consecutive blocks. With 2+ consecutive slots, a validator can manipulate a short TWAP without competition.

**Defense**: Use longer TWAP windows (>30 min) or combine TWAP with Chainlink.

## Chainlink Integration

```solidity
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

error Oracle_StalePrice(address feed, uint256 updatedAt, uint256 maxAge);
error Oracle_InvalidRound(uint80 roundId, uint80 answeredInRound);
error Oracle_NegativePrice(int256 price);
error Oracle_SequencerDown();
error Oracle_GracePeriod();

uint256 public constant MAX_STALENESS = 3600; // 1 hour

function getChainlinkPrice(AggregatorV3Interface feed) internal view returns (uint256) {
    (
        uint80 roundId,
        int256 answer,
        ,
        uint256 updatedAt,
        uint80 answeredInRound
    ) = feed.latestRoundData();

    if (answer <= 0) revert Oracle_NegativePrice(answer);
    if (updatedAt == 0) revert Oracle_StalePrice(address(feed), 0, MAX_STALENESS);
    if (block.timestamp - updatedAt > MAX_STALENESS) {
        revert Oracle_StalePrice(address(feed), updatedAt, MAX_STALENESS);
    }
    if (answeredInRound < roundId) {
        revert Oracle_InvalidRound(roundId, answeredInRound);
    }

    return uint256(answer);
}
```

### Chainlink Staleness by Feed

Different feeds have different heartbeats. Match your staleness check to the feed's heartbeat.

| Feed | Heartbeat | Suggested MAX_STALENESS |
|------|-----------|----------------------|
| ETH/USD (mainnet) | 1 hour | 3,600s |
| BTC/USD (mainnet) | 1 hour | 3,600s |
| USDC/USD | 24 hours | 86,400s |
| Low-cap tokens | Varies | Check feed docs |

## L2 Sequencer Downtime

On L2s (Arbitrum, Optimism), if the sequencer goes down and comes back up, stale prices may be used. Check the sequencer uptime feed.

```solidity
AggregatorV3Interface public immutable SEQUENCER_UPTIME_FEED;
uint256 public constant GRACE_PERIOD = 3600; // 1 hour

function _checkSequencer() internal view {
    (, int256 answer, , uint256 startedAt,) = SEQUENCER_UPTIME_FEED.latestRoundData();

    // answer == 0: sequencer is up
    // answer == 1: sequencer is down
    if (answer != 0) revert Oracle_SequencerDown();

    uint256 timeSinceUp = block.timestamp - startedAt;
    if (timeSinceUp < GRACE_PERIOD) revert Oracle_GracePeriod();
}

function getPrice(AggregatorV3Interface feed) external view returns (uint256) {
    _checkSequencer();
    return getChainlinkPrice(feed);
}
```

## Sandwich Oracle Updates

Attackers can watch the mempool for Chainlink oracle update transactions and sandwich them.

```
1. See Chainlink update TX that will change ETH price from $2000 to $2100
2. Front-run: open leveraged long position at $2000 price
3. Oracle update executes: price becomes $2100
4. Back-run: close position at $2100, profit from the price jump
```

**Defense**: Use time-delayed oracle consumption or spread oracle updates over multiple blocks.

## Multi-Oracle Fallback

```solidity
function getPrice() external view returns (uint256 price) {
    // Try Chainlink first
    try this._getChainlinkPrice() returns (uint256 chainlinkPrice) {
        return chainlinkPrice;
    } catch {}

    // Fallback to TWAP
    try this._getTwapPrice() returns (uint256 twapPrice) {
        return twapPrice;
    } catch {}

    revert Oracle_AllFeedsFailed();
}
```

## Oracle Integration Checklist

- [ ] No spot price usage for value calculations
- [ ] Chainlink: staleness check with feed-appropriate threshold
- [ ] Chainlink: negative/zero price check
- [ ] Chainlink: `answeredInRound >= roundId` check
- [ ] L2: sequencer uptime feed checked with grace period
- [ ] TWAP: window >= 30 minutes for security-critical reads
- [ ] Fallback oracle configured for primary feed failure
- [ ] Oracle decimals handled correctly (Chainlink USD feeds = 8 decimals)
- [ ] Price deviation circuit breaker for sudden large moves
