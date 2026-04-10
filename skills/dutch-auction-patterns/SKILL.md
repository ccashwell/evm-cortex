---
name: dutch-auction-patterns
description: Use when implementing Dutch auctions for token sales, NFT mints, fair launch mechanisms, or Gradual Dutch Auctions (GDAs). Covers linear/exponential price decay, batch auctions, and MEV-resistant patterns.
---

# Dutch Auction Patterns

## How Dutch Auctions Work

Price starts high and decreases over time until buyers step in. This is inherently fair — buyers pay their maximum willingness-to-pay, and price discovery happens naturally.

```
price(t) = startPrice - (startPrice - endPrice) * elapsed / duration   // linear
price(t) = startPrice * decay^elapsed                                  // exponential
```

## Linear Dutch Auction

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract DutchAuction is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable seller;

    uint256 public immutable startPrice;
    uint256 public immutable endPrice;
    uint256 public immutable startTime;
    uint256 public immutable duration;
    uint256 public immutable totalTokens;
    uint256 public tokensSold;

    constructor(
        IERC20 _token,
        uint256 _startPrice,
        uint256 _endPrice,
        uint256 _startTime,
        uint256 _duration,
        uint256 _totalTokens
    ) {
        require(_startPrice > _endPrice, "start must exceed end");
        require(_startTime >= block.timestamp, "start in future");
        require(_duration > 0, "duration > 0");

        token = _token;
        seller = msg.sender;
        startPrice = _startPrice;
        endPrice = _endPrice;
        startTime = _startTime;
        duration = _duration;
        totalTokens = _totalTokens;
    }

    function currentPrice() public view returns (uint256) {
        if (block.timestamp < startTime) return startPrice;

        uint256 elapsed = block.timestamp - startTime;
        if (elapsed >= duration) return endPrice;

        uint256 priceDrop = (startPrice - endPrice) * elapsed / duration;
        return startPrice - priceDrop;
    }

    function buy(uint256 amount) external payable nonReentrant {
        require(block.timestamp >= startTime, "not started");
        require(tokensSold + amount <= totalTokens, "sold out");

        uint256 price = currentPrice();
        uint256 cost = price * amount / 1e18;
        require(msg.value >= cost, "insufficient payment");

        tokensSold += amount;
        token.safeTransfer(msg.sender, amount);

        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "refund failed");
        }

        emit Purchase(msg.sender, amount, price);
    }

    function withdrawProceeds() external {
        require(msg.sender == seller, "only seller");
        (bool ok, ) = seller.call{value: address(this).balance}("");
        require(ok, "transfer failed");
    }

    function withdrawUnsold() external {
        require(msg.sender == seller, "only seller");
        require(block.timestamp >= startTime + duration, "auction active");
        uint256 unsold = totalTokens - tokensSold;
        if (unsold > 0) token.safeTransfer(seller, unsold);
    }

    event Purchase(address indexed buyer, uint256 amount, uint256 price);
}
```

## Exponential Price Decay

More aggressive initial decay that levels off:

```solidity
// Uses fixed-point math: price = startPrice * (1 - decayRate)^elapsed_seconds
// With WAD math (1e18 scale):
function currentPrice() public view returns (uint256) {
    uint256 elapsed = block.timestamp - startTime;
    if (elapsed >= duration) return endPrice;

    // decayPerSecond in WAD, e.g., 0.9999e18 for slow decay
    uint256 factor = wadPow(decayPerSecond, elapsed);
    uint256 price = startPrice * factor / 1e18;
    return price < endPrice ? endPrice : price;
}
```

## Gradual Dutch Auction (GDA)

GDA emits tokens continuously, each with its own Dutch auction. Used by Art Gobblers / Paradigm research:

```solidity
// price = initialPrice * scaleFactor^(timeSinceStart) * decayFactor^(timeSinceLastPurchase)
// Allows price to reset after each purchase while maintaining emission schedule.

function getPrice(uint256 numTokensPurchased) public view returns (uint256) {
    uint256 timeSinceStart = block.timestamp - auctionStartTime;
    uint256 timeSinceLastPurchase = block.timestamp - lastPurchaseTime;

    // Uses VRGDA formula:
    // p = p0 * e^(k * (numSold - f(t)))
    // where f(t) is the target emission schedule
    int256 decayExponent = wadLn(1e18 - decayConstant) * int256(timeSinceLastPurchase);
    return uint256(wadMul(int256(targetPrice), wadExp(decayExponent)));
}
```

## Batch Dutch Auction (Uniform Price)

All bidders pay the same clearing price — the price at which demand meets supply:

```solidity
struct Bid {
    address bidder;
    uint256 amount;
    uint256 timestamp;
}

// During auction: collect bids with timestamps
// After auction: compute clearing price = price at which sum(bids) >= totalTokens
// All successful bidders pay the clearing price, excess refunded

function settle() external {
    require(block.timestamp >= startTime + duration, "auction active");
    // Sort bids by timestamp (earlier = higher price)
    // Find clearing point where cumulative amount >= totalTokens
    // Set clearingPrice = price at that timestamp
    // Refund excess to partial fills and losing bids
}
```

## Fair Launch Design

Combine Dutch auction with anti-whale measures:

```solidity
uint256 public constant MAX_PER_WALLET = 100e18;
mapping(address => uint256) public purchased;

function buy(uint256 amount) external payable {
    require(purchased[msg.sender] + amount <= MAX_PER_WALLET, "wallet cap");
    purchased[msg.sender] += amount;
    // ... standard auction logic
}
```

## MEV Considerations

- Dutch auctions are naturally resistant to front-running (price is time-based)
- Batch auctions with uniform clearing price eliminate ordering advantage
- Consider commit-reveal for large token sales
- Block timestamp can be manipulated by ~12 seconds (validators)

## Checklist

- [ ] `startPrice > endPrice` enforced in constructor
- [ ] Price function handles pre-start, during, and post-auction states
- [ ] Refund excess ETH on overpayment
- [ ] Seller can withdraw proceeds and unsold tokens after auction
- [ ] Per-wallet caps for fair distribution
- [ ] `nonReentrant` on buy function (ETH refund creates reentrancy risk)
- [ ] Consider commit-reveal for high-value auctions
- [ ] Test boundary conditions: first block, last block, after end
- [ ] Gas efficiency for high-demand auctions (many concurrent buyers)
