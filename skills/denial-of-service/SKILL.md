---
name: denial-of-service
description: Denial-of-service attack vectors and prevention patterns for Solidity. Use when designing loops, batch operations, withdrawal mechanisms, or any contract that iterates over user-controlled data. Covers unbounded loops, gas limits, griefing, and force-send ETH.
---

# Denial of Service

## Unbounded Loops Over Dynamic Arrays

Iterating over arrays that grow with user interaction will eventually exceed the block gas limit.

```solidity
// VULNERABLE: array grows unboundedly
address[] public stakers;

function distributeRewards() external {
    // If stakers.length > ~1500, this exceeds block gas limit
    for (uint256 i; i < stakers.length; ++i) {
        _sendReward(stakers[i]);
    }
}
```

### Defense: Pull Pattern

```solidity
// Users claim their own rewards — no unbounded iteration
mapping(address => uint256) public pendingRewards;

function claimReward() external {
    uint256 amount = pendingRewards[msg.sender];
    if (amount == 0) revert NothingToClaim();

    pendingRewards[msg.sender] = 0;

    (bool success,) = msg.sender.call{value: amount}("");
    if (!success) revert TransferFailed();

    emit RewardClaimed(msg.sender, amount);
}
```

### Defense: Paginated Processing

```solidity
uint256 public lastProcessedIndex;

function distributeRewards(uint256 batchSize) external {
    uint256 end = lastProcessedIndex + batchSize;
    if (end > stakers.length) end = stakers.length;

    for (uint256 i = lastProcessedIndex; i < end;) {
        _sendReward(stakers[i]);
        unchecked { ++i; }
    }

    lastProcessedIndex = end;

    if (end == stakers.length) {
        lastProcessedIndex = 0; // reset for next round
        emit DistributionComplete();
    }
}
```

## External Call Failures Blocking Execution

A single failing external call in a loop blocks all subsequent operations.

```solidity
// VULNERABLE: one failed transfer blocks all
function distributeAll(address[] calldata recipients, uint256[] calldata amounts) external {
    for (uint256 i; i < recipients.length; ++i) {
        IERC20(token).safeTransfer(recipients[i], amounts[i]); // if one reverts, all fail
    }
}

// FIXED: record failures, continue processing
function distributeAll(address[] calldata recipients, uint256[] calldata amounts) external {
    for (uint256 i; i < recipients.length;) {
        try IERC20(token).transfer(recipients[i], amounts[i]) returns (bool success) {
            if (!success) {
                pendingClaims[recipients[i]] += amounts[i];
                emit DistributionFailed(recipients[i], amounts[i]);
            }
        } catch {
            pendingClaims[recipients[i]] += amounts[i];
            emit DistributionFailed(recipients[i], amounts[i]);
        }
        unchecked { ++i; }
    }
}
```

## Unexpected Reverts (Push vs Pull)

Contracts that don't accept ETH (no `receive()` or `fallback()`) will cause `call` to revert, blocking push-based distributions.

```solidity
// VULNERABLE: recipient can be a contract that reverts on receive
function payWinner(address winner) external {
    (bool success,) = winner.call{value: prize}("");
    require(success); // blocks if winner is a contract that reverts
}

// FIXED: pull pattern
mapping(address => uint256) public claimable;

function recordWinner(address winner) external onlyOwner {
    claimable[winner] += prize;
    emit WinnerRecorded(winner, prize);
}

function claim() external {
    uint256 amount = claimable[msg.sender];
    if (amount == 0) revert NothingToClaim();
    claimable[msg.sender] = 0;
    (bool success,) = msg.sender.call{value: amount}("");
    if (!success) revert TransferFailed();
}
```

## Block Gas Limit DoS

Functions that approach the block gas limit become uncallable.

```solidity
// Gas estimation per operation:
// SLOAD (cold):      2,100 gas
// SLOAD (warm):        100 gas
// SSTORE (cold):    20,000 gas (new value)
// SSTORE (warm):     2,900 gas
// External call:     2,600 gas (cold account)
// ETH transfer:      9,000 gas (with value)
// ERC-20 transfer:  ~50,000 gas

// Block gas limit: ~30M gas (mainnet)
// Safe iteration: ~300-600 operations per transaction
// Always test with forge gas reports
```

## Griefing Attacks

Attackers who can waste protocol gas or block operations without direct profit.

```solidity
// VULNERABLE: attacker creates many small positions to inflate loop iterations
function liquidateAll() external {
    for (uint256 i; i < positions.length; ++i) {
        if (isLiquidatable(positions[i])) {
            _liquidate(positions[i]);
        }
    }
}

// DEFENSE: liquidate specific positions by ID
function liquidate(uint256[] calldata positionIds) external {
    for (uint256 i; i < positionIds.length;) {
        if (!isLiquidatable(positionIds[i])) revert NotLiquidatable(positionIds[i]);
        _liquidate(positionIds[i]);
        unchecked { ++i; }
    }
}
```

### Minimum Deposit / Position Size

```solidity
uint256 public constant MIN_DEPOSIT = 0.01 ether;

function deposit() external payable {
    if (msg.value < MIN_DEPOSIT) revert BelowMinimum(msg.value, MIN_DEPOSIT);
    // prevents dust position griefing
}
```

## Force-Sending ETH via selfdestruct

A contract can receive ETH via `selfdestruct(target)` even without `receive()` or `fallback()`. Never rely on `address(this).balance` for accounting.

```solidity
// VULNERABLE: invariant relies on balance
function invariantCheck() external view {
    require(address(this).balance == totalDeposited); // can be broken by force-send
}

// FIXED: track deposits explicitly
uint256 public totalDeposited;

function deposit() external payable {
    totalDeposited += msg.value;
}

function invariantCheck() external view {
    require(totalDeposited >= totalWithdrawn);
}
```

Note: Post-Dencun (EIP-6780), `selfdestruct` only sends ETH if called in the same transaction as contract creation.

## RETURNDATA Bomb

A malicious contract can return a massive `returndata`, causing the caller to spend gas copying it.

```solidity
// VULNERABLE: copies all return data
(bool success, bytes memory data) = target.call(payload);

// SAFER: limit return data copy
(bool success,) = target.call(payload);
// Only copy return data if you need it and know the expected size
```

## DoS Prevention Checklist

- [ ] No unbounded loops over user-controlled arrays
- [ ] Pull pattern for fund distribution (users claim their own)
- [ ] Paginated processing for batch operations
- [ ] External call failures don't block other operations
- [ ] Minimum deposit/position sizes to prevent dust griefing
- [ ] No reliance on `address(this).balance` for accounting
- [ ] Gas consumption tested for worst-case array sizes
- [ ] Critical functions estimated to stay well under block gas limit
