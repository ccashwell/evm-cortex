---
name: chainlink-oracles
description: Use when integrating Chainlink price feeds, building oracle-dependent contracts, or implementing staleness checks. Covers AggregatorV3Interface, decimal handling, L2 sequencer uptime, heartbeat validation, and safe price feed wrappers.
---

# Chainlink Oracle Integration

## Core Interface

```solidity
import {AggregatorV3Interface} from
    "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,     // price (check decimals!)
        uint256 startedAt,
        uint256 updatedAt, // critical for staleness
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}
```

## Complete Safe Price Feed Wrapper

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AggregatorV3Interface} from
    "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract ChainlinkPriceFeed {
    error StalePrice(uint256 updatedAt, uint256 maxAge);
    error InvalidPrice(int256 price);
    error SequencerDown();
    error SequencerGracePeriod(uint256 timeSinceUp);

    AggregatorV3Interface public immutable priceFeed;
    AggregatorV3Interface public immutable sequencerFeed; // L2 only
    uint256 public immutable maxStaleness;
    uint256 public constant SEQUENCER_GRACE_PERIOD = 3600; // 1 hour

    constructor(
        address _priceFeed,
        address _sequencerFeed, // address(0) on L1
        uint256 _maxStaleness
    ) {
        priceFeed = AggregatorV3Interface(_priceFeed);
        sequencerFeed = AggregatorV3Interface(_sequencerFeed);
        maxStaleness = _maxStaleness;
    }

    function getPrice() external view returns (uint256) {
        _checkSequencer();

        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt == 0) revert InvalidPrice(answer);
        if (block.timestamp - updatedAt > maxStaleness) {
            revert StalePrice(updatedAt, maxStaleness);
        }
        if (answeredInRound < roundId) revert StalePrice(updatedAt, maxStaleness);

        return uint256(answer);
    }

    function _checkSequencer() internal view {
        if (address(sequencerFeed) == address(0)) return; // L1, skip

        (, int256 answer, , uint256 startedAt, ) = sequencerFeed.latestRoundData();

        // answer == 0: sequencer is up; answer == 1: sequencer is down
        if (answer != 0) revert SequencerDown();

        uint256 timeSinceUp = block.timestamp - startedAt;
        if (timeSinceUp < SEQUENCER_GRACE_PERIOD) {
            revert SequencerGracePeriod(timeSinceUp);
        }
    }

    function decimals() external view returns (uint8) {
        return priceFeed.decimals();
    }
}
```

## Decimal Handling

Chainlink feeds have varying decimals:

| Feed Type | Decimals | Example |
|-----------|----------|---------|
| USD pairs | 8 | ETH/USD = 3500.00000000 |
| ETH pairs | 18 | USDC/ETH = 0.000285... |
| Non-USD | varies | Check `decimals()` |

```solidity
function normalizePrice(
    AggregatorV3Interface feed,
    uint8 targetDecimals
) internal view returns (uint256) {
    (, int256 answer, , , ) = feed.latestRoundData();
    uint8 feedDecimals = feed.decimals();

    if (feedDecimals < targetDecimals) {
        return uint256(answer) * 10 ** (targetDecimals - feedDecimals);
    } else {
        return uint256(answer) / 10 ** (feedDecimals - targetDecimals);
    }
}
```

## Staleness Thresholds by Feed

| Feed | Heartbeat | Recommended maxStaleness |
|------|-----------|--------------------------|
| ETH/USD | 1 hour | 3600 + buffer (3900s) |
| BTC/USD | 1 hour | 3900s |
| USDC/USD | 24 hours | 86400 + buffer |
| Stablecoin pairs | 24 hours | 90000s |
| L2 feeds | varies | Check docs per chain |

## L2 Sequencer Uptime Feed

On Arbitrum, Optimism, and other L2s, the sequencer can go down. After it comes back, prices may be stale:

```
Arbitrum Sequencer Feed: 0xFdB631F5EE196F0ed6FAa767959853A9F217697D
Optimism Sequencer Feed: 0x371EAD81c9102C9BF4874A9075FFFf170F2Ee389
```

Always check the sequencer feed on L2 before trusting price data.

## Multi-Oracle Pattern

For critical price dependencies, use multiple oracles with a fallback:

```solidity
function getPrice() external view returns (uint256) {
    try this._getChainlinkPrice() returns (uint256 price) {
        return price;
    } catch {
        return _getFallbackPrice(); // Uniswap TWAP, Redstone, etc.
    }
}
```

## Checklist

- [ ] Validate `answer > 0` from `latestRoundData()`
- [ ] Check `updatedAt` against a staleness threshold
- [ ] Verify `answeredInRound >= roundId`
- [ ] Handle decimal normalization between feeds and your contract
- [ ] On L2: check sequencer uptime feed + grace period
- [ ] Set staleness threshold based on feed's heartbeat (with buffer)
- [ ] Never hardcode prices or assume 8 decimals
- [ ] Consider a fallback oracle for critical price paths
- [ ] Test oracle failure modes (stale price, zero price, sequencer down)
