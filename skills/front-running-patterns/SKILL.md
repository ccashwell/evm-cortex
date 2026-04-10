---
name: front-running-patterns
description: Front-running and MEV protection patterns for Solidity protocols. Use when designing swaps, auctions, NFT mints, or any transaction-ordering-dependent logic. Covers sandwich attacks, commit-reveal, Flashbots, slippage protection, and deadline parameters.
---

# Front-Running & MEV Patterns

## What Is MEV?

Maximal Extractable Value (MEV) is the profit extractable by reordering, inserting, or censoring transactions within a block. Validators and searchers extract MEV through:

- **Sandwich attacks**: front-run + back-run a victim's swap
- **Front-running**: copy a profitable transaction and get it mined first
- **Back-running**: execute immediately after a target transaction
- **Liquidation racing**: compete to liquidate undercollateralized positions
- **Just-in-Time (JIT) liquidity**: add/remove concentrated liquidity around a trade

## Sandwich Attacks on Swaps

```
1. Victim submits swap: buy 100 ETH of TOKEN
2. Attacker front-runs: buys TOKEN, pushing price up
3. Victim's swap executes at worse price
4. Attacker back-runs: sells TOKEN at inflated price
```

### Defense: Slippage Protection

```solidity
error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);

function swap(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 minAmountOut,   // user sets minimum acceptable output
    uint256 deadline
) external returns (uint256 amountOut) {
    if (block.timestamp > deadline) revert Expired();

    amountOut = _executeSwap(tokenIn, tokenOut, amountIn);

    if (amountOut < minAmountOut) {
        revert SlippageExceeded(amountOut, minAmountOut);
    }

    emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
}
```

### Defense: Deadline Parameters

Without deadlines, pending transactions can be held in the mempool and executed later at unfavorable prices.

```solidity
modifier beforeDeadline(uint256 deadline) {
    if (block.timestamp > deadline) revert TransactionExpired(deadline, block.timestamp);
    _;
}

function addLiquidity(
    uint256 amount0,
    uint256 amount1,
    uint256 minLiquidity,
    uint256 deadline
) external beforeDeadline(deadline) returns (uint256 liquidity) {
    // ...
}
```

## Commit-Reveal Scheme

For auctions, NFT mints, or any scenario where knowing the action gives an advantage.

```solidity
uint256 public constant COMMIT_PERIOD = 1 hours;
uint256 public constant REVEAL_PERIOD = 30 minutes;
uint256 public constant MIN_COMMIT_AGE = 2 minutes; // at least 1 block gap

mapping(address => bytes32) public commitments;
mapping(address => uint256) public commitTimestamps;

function commit(bytes32 hash) external {
    commitments[msg.sender] = hash;
    commitTimestamps[msg.sender] = block.timestamp;
    emit Committed(msg.sender);
}

function reveal(uint256 bid, bytes32 salt) external {
    uint256 commitTime = commitTimestamps[msg.sender];
    if (commitTime == 0) revert NoCommitment();
    if (block.timestamp < commitTime + MIN_COMMIT_AGE) revert RevealTooEarly();
    if (block.timestamp > commitTime + COMMIT_PERIOD + REVEAL_PERIOD) revert RevealExpired();

    bytes32 expected = keccak256(abi.encodePacked(msg.sender, bid, salt));
    if (commitments[msg.sender] != expected) revert InvalidReveal();

    commitments[msg.sender] = bytes32(0);
    _processBid(msg.sender, bid);
}
```

## Flashbots Protect / Private Mempool

Transactions submitted through Flashbots or similar services skip the public mempool, making them invisible to sandwich bots.

```typescript
// Frontend integration: submit via Flashbots Protect RPC
const provider = new ethers.JsonRpcProvider("https://rpc.flashbots.net");
const tx = await signer.sendTransaction({
  to: routerAddress,
  data: encodedSwap,
  // Flashbots Protect: not visible in public mempool
});
```

**Limitations**:
- Doesn't protect against validator-level MEV
- Transaction may take longer to be included
- Not all chains support Flashbots

## Transaction Ordering Dependence

Any logic where the outcome depends on transaction order is vulnerable.

```solidity
// VULNERABLE: first caller wins
function claim(uint256 tokenId) external {
    require(!claimed[tokenId], "Already claimed");
    claimed[tokenId] = true;
    _mint(msg.sender, tokenId);
}

// SAFER: randomized or committed selection
// Use commit-reveal or Chainlink VRF for fair selection
```

## MEV Protection for AMMs

### Concentrated Liquidity JIT Protection

```solidity
// Track when liquidity was added to prevent JIT manipulation
mapping(uint256 => uint256) public positionMintBlock;

function mint(uint256 positionId, ...) external {
    positionMintBlock[positionId] = block.number;
    // ...
}

function collectFees(uint256 positionId) external {
    // Require liquidity existed for at least N blocks before fee collection
    if (block.number - positionMintBlock[positionId] < MIN_LIQUIDITY_BLOCKS) {
        revert LiquidityTooRecent();
    }
    // ...
}
```

## Price Update Front-Running

Oracle price updates can be front-run by MEV searchers who see the update in the mempool.

```
1. Chainlink oracle update TX: ETH price changes from $2000 → $2100
2. Attacker front-runs: opens leveraged long at $2000
3. Oracle updates: price becomes $2100
4. Attacker closes: profit from $100 move with leverage
```

**Defense**:
- Time-weighted or multi-block oracle consumption
- Execution delay after position changes
- Fee charged on rapid open/close cycles

## MEV Protection Checklist

- [ ] Slippage protection (`minAmountOut`) on all swap functions
- [ ] Deadline parameter on all time-sensitive operations
- [ ] Commit-reveal for auctions, mints, and competitive actions
- [ ] Frontend uses private mempool (Flashbots Protect) for swaps
- [ ] No first-come-first-served mechanisms without mitigation
- [ ] Oracle updates not exploitable via price front-running
- [ ] Liquidity operations protected against JIT manipulation
- [ ] Fee structures disincentivize atomic open/close (anti-sandwich)
- [ ] Price impact limits on single-transaction trades
