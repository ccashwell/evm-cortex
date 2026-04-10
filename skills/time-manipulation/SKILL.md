---
name: time-manipulation
description: Time-based vulnerability patterns and safe usage for Solidity contracts. Use when implementing unlock schedules, cooldowns, auctions, or any time-dependent logic. Covers block.timestamp manipulation, epoch boundary attacks, and safe time patterns.
---

# Time Manipulation

## block.timestamp Manipulation

Validators/miners have limited control over `block.timestamp`:
- Must be greater than parent block's timestamp
- Must be within ~15 seconds of real time (consensus rule)
- Post-merge: fixed 12-second slots, but validator chooses timestamp within bounds

```solidity
// Safe for: time ranges > 15 seconds
// Unsafe for: precise sub-minute timing, randomness

// VULNERABLE: exact-second conditions
if (block.timestamp == auctionEnd) { ... } // may never be true

// SAFE: range-based conditions
if (block.timestamp >= auctionEnd) { ... } // will always become true
```

## Time-Dependent Logic Risks

### Unlock Schedule Gaming

```solidity
// VULNERABLE: cliff unlock at exact timestamp
function claimVested() external {
    if (block.timestamp < cliff) revert NotVested();
    uint256 amount = totalAllocation; // full amount at cliff
    _transfer(msg.sender, amount);
}

// Risk: validator can set timestamp to just past cliff in their block
// This allows early claiming relative to wall clock time

// SAFE: linear vesting reduces impact of timestamp manipulation
function claimVested() external {
    uint256 elapsed = block.timestamp - vestingStart;
    if (elapsed == 0) revert NotVested();

    uint256 totalDuration = vestingEnd - vestingStart;
    uint256 vested = totalAllocation * Math.min(elapsed, totalDuration) / totalDuration;
    uint256 claimable = vested - alreadyClaimed[msg.sender];

    if (claimable == 0) revert NothingToClaim();

    alreadyClaimed[msg.sender] += claimable;
    token.safeTransfer(msg.sender, claimable);
}
```

### Cooldown Bypass

```solidity
// VULNERABLE: short cooldown can be bypassed by timestamp manipulation
uint256 public constant COOLDOWN = 30 seconds;

mapping(address => uint256) public lastAction;

function doAction() external {
    if (block.timestamp - lastAction[msg.sender] < COOLDOWN) revert Cooldown();
    lastAction[msg.sender] = block.timestamp;
    // A validator can set timestamp 30s ahead to bypass cooldown
}

// SAFER: use block numbers for short cooldowns
uint256 public constant COOLDOWN_BLOCKS = 3; // ~36 seconds

mapping(address => uint256) public lastActionBlock;

function doAction() external {
    if (block.number - lastActionBlock[msg.sender] < COOLDOWN_BLOCKS) revert Cooldown();
    lastActionBlock[msg.sender] = block.number;
}
```

## Epoch Boundary Attacks

Protocols with discrete time periods (epochs, rounds) are vulnerable at boundaries.

```solidity
// VULNERABLE: reward rate changes at epoch boundary
function getRewardRate() public view returns (uint256) {
    uint256 epoch = block.timestamp / EPOCH_DURATION;
    return epochRewardRates[epoch];
}

// Attack: validator manipulates timestamp to straddle epochs
// Deposit at end of high-reward epoch, claim, withdraw at start of next

// DEFENSE: actions locked near epoch boundaries
uint256 public constant BOUNDARY_BUFFER = 5 minutes;

function deposit(uint256 amount) external {
    uint256 timeInEpoch = block.timestamp % EPOCH_DURATION;
    if (timeInEpoch > EPOCH_DURATION - BOUNDARY_BUFFER) revert NearEpochBoundary();
    if (timeInEpoch < BOUNDARY_BUFFER) revert NearEpochBoundary();
    // safe to deposit
}
```

## Dutch Auction Time Manipulation

```solidity
// Dutch auction: price decreases over time
// Validator can manipulate timestamp to get a lower price

function getCurrentPrice() public view returns (uint256) {
    uint256 elapsed = block.timestamp - auctionStart;
    if (elapsed >= auctionDuration) return reservePrice;

    uint256 priceRange = startPrice - reservePrice;
    return startPrice - (priceRange * elapsed / auctionDuration);
}

// Impact: validator gains at most ~15 seconds of price decrease
// For most auction speeds, this is negligible
// For very fast auctions (price drops rapidly), use block numbers instead
```

## block.number vs block.timestamp

| Feature | block.number | block.timestamp |
|---------|-------------|-----------------|
| Manipulation | Not manipulable | ~15s drift |
| Precision | Per-block (12s) | Per-second |
| Cross-chain | Inconsistent | More consistent |
| Post-merge | Fixed interval | Fixed interval |
| Use for | Short cooldowns, ordering | Long durations, deadlines |

```solidity
// block.number: use for short-duration, manipulation-sensitive logic
// block.timestamp: use for long-duration, human-readable deadlines

// Short cooldown: use blocks
uint256 public constant WITHDRAWAL_DELAY_BLOCKS = 50; // ~10 minutes

// Long deadline: use timestamp
uint256 public constant PROPOSAL_DURATION = 7 days;
```

## Safe Time Patterns

### Time-Locked Actions

```solidity
struct TimeLock {
    uint48 executeAfter;
    bool executed;
}

uint256 public constant MIN_DELAY = 2 days;

mapping(bytes32 => TimeLock) public timelocks;

function schedule(bytes32 actionId) external onlyOwner {
    timelocks[actionId] = TimeLock({
        executeAfter: uint48(block.timestamp + MIN_DELAY),
        executed: false
    });
    emit ActionScheduled(actionId, block.timestamp + MIN_DELAY);
}

function execute(bytes32 actionId) external onlyOwner {
    TimeLock storage lock = timelocks[actionId];
    if (lock.executeAfter == 0) revert NotScheduled();
    if (lock.executed) revert AlreadyExecuted();
    if (block.timestamp < lock.executeAfter) revert TooEarly();

    lock.executed = true;
    _executeAction(actionId);
}
```

### Deadline Pattern

```solidity
modifier beforeDeadline(uint256 deadline) {
    if (block.timestamp > deadline) revert Expired(deadline);
    _;
}

// Always use >= for "ready" checks, > for expiry checks
function isReady(uint256 readyAt) internal view returns (bool) {
    return block.timestamp >= readyAt;
}

function isExpired(uint256 deadline) internal view returns (bool) {
    return block.timestamp > deadline;
}
```

### Rate Limiting

```solidity
struct RateLimit {
    uint48 lastAction;
    uint16 actionsInWindow;
}

uint256 public constant WINDOW = 1 hours;
uint256 public constant MAX_ACTIONS_PER_WINDOW = 10;

mapping(address => RateLimit) public rateLimits;

function checkRateLimit(address user) internal {
    RateLimit storage limit = rateLimits[user];

    if (block.timestamp - limit.lastAction > WINDOW) {
        // New window
        limit.actionsInWindow = 1;
        limit.lastAction = uint48(block.timestamp);
    } else {
        if (limit.actionsInWindow >= MAX_ACTIONS_PER_WINDOW) {
            revert RateLimitExceeded();
        }
        limit.actionsInWindow += 1;
    }
}
```

## Time Safety Checklist

- [ ] No exact-time equality checks (`==` on timestamps)
- [ ] `>=` for "ready" checks, `>` for expiry checks
- [ ] Short cooldowns use block numbers, not timestamps
- [ ] Long durations use timestamps for readability
- [ ] Linear vesting preferred over cliff vesting (reduces manipulation impact)
- [ ] Epoch boundaries have buffer zones
- [ ] Deadline parameters on all time-sensitive user operations
- [ ] Timelocks have minimum delays that cannot be reduced by governance
- [ ] No use of `block.timestamp` for randomness
- [ ] Dutch auctions: price decrease per 15s is acceptable loss
