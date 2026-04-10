---
name: solidity-patterns
description: Core Solidity design patterns for safe, maintainable smart contracts. Use when writing new contracts, reviewing architecture, or refactoring existing protocol code. Covers checks-effects-interactions, pull-over-push, guard checks, state machines, access restriction, and commit-reveal.
---

# Solidity Design Patterns

## Checks-Effects-Interactions (CEI)

The most critical pattern in Solidity. All functions that interact with external contracts must follow this order:

1. **Checks** — validate inputs and preconditions
2. **Effects** — update state
3. **Interactions** — call external contracts

```solidity
function withdraw(uint256 amount) external {
    // CHECKS
    if (amount == 0) revert ZeroAmount();
    if (balances[msg.sender] < amount) revert InsufficientBalance();

    // EFFECTS
    balances[msg.sender] -= amount;

    // INTERACTIONS
    (bool success,) = msg.sender.call{value: amount}("");
    if (!success) revert TransferFailed();

    emit Withdrawn(msg.sender, amount);
}
```

Violating CEI is the root cause of reentrancy. Even with ReentrancyGuard, always write CEI-compliant code as defense in depth.

## Pull-Over-Push

Never iterate over recipients to push funds. Let users withdraw (pull) their own funds.

```solidity
// BAD: Push pattern — one revert blocks everyone
function distributeRewards(address[] calldata recipients, uint256[] calldata amounts) external {
    for (uint256 i; i < recipients.length; ++i) {
        payable(recipients[i]).transfer(amounts[i]); // reverts if any fails
    }
}

// GOOD: Pull pattern — each user claims independently
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

## Guard Check Pattern

Centralize validation in modifiers or internal functions for reuse and consistency.

```solidity
error Unauthorized();
error InvalidAmount();
error Expired(uint256 deadline);

modifier onlyWhitelisted() {
    if (!whitelist[msg.sender]) revert Unauthorized();
    _;
}

modifier validAmount(uint256 amount) {
    if (amount == 0 || amount > MAX_AMOUNT) revert InvalidAmount();
    _;
}

modifier beforeDeadline(uint256 deadline) {
    if (block.timestamp > deadline) revert Expired(deadline);
    _;
}

function deposit(uint256 amount, uint256 deadline)
    external
    onlyWhitelisted
    validAmount(amount)
    beforeDeadline(deadline)
{
    // core logic only — all checks in modifiers
}
```

## State Machine Pattern

Enforce valid state transitions for multi-phase protocols (auctions, vesting, governance).

```solidity
enum AuctionState { Created, Bidding, Ended, Settled }

AuctionState public state;

error InvalidState(AuctionState expected, AuctionState actual);

modifier inState(AuctionState expected) {
    if (state != expected) revert InvalidState(expected, state);
    _;
}

function startBidding() external onlyOwner inState(AuctionState.Created) {
    state = AuctionState.Bidding;
    emit BiddingStarted(block.timestamp);
}

function endBidding() external onlyOwner inState(AuctionState.Bidding) {
    state = AuctionState.Ended;
    emit BiddingEnded(block.timestamp);
}

function settle() external inState(AuctionState.Ended) {
    state = AuctionState.Settled;
    // settlement logic
}
```

## Access Restriction Pattern

Layer access control for different privilege levels.

```solidity
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract Treasury is AccessControl {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    uint256 public constant LARGE_THRESHOLD = 100 ether;

    function executeSmall(address to, uint256 amount)
        external
        onlyRole(EXECUTOR_ROLE)
    {
        if (amount >= LARGE_THRESHOLD) revert ExceedsThreshold();
        _transfer(to, amount);
    }

    function executeLarge(address to, uint256 amount)
        external
        onlyRole(MANAGER_ROLE)
    {
        _transfer(to, amount);
    }
}
```

## Commit-Reveal Pattern

Prevent front-running by splitting actions into commit and reveal phases.

```solidity
struct Commitment {
    bytes32 hash;
    uint64 timestamp;
    bool revealed;
}

mapping(address => Commitment) public commitments;

uint256 public constant REVEAL_WINDOW = 1 hours;
uint256 public constant MIN_COMMIT_AGE = 1 minutes;

function commit(bytes32 hash) external {
    commitments[msg.sender] = Commitment({
        hash: hash,
        timestamp: uint64(block.timestamp),
        revealed: false
    });
    emit Committed(msg.sender, hash);
}

function reveal(uint256 value, bytes32 salt) external {
    Commitment storage c = commitments[msg.sender];

    if (c.hash == bytes32(0)) revert NoCommitment();
    if (c.revealed) revert AlreadyRevealed();
    if (block.timestamp < c.timestamp + MIN_COMMIT_AGE) revert TooEarly();
    if (block.timestamp > c.timestamp + REVEAL_WINDOW) revert RevealExpired();

    bytes32 expected = keccak256(abi.encodePacked(msg.sender, value, salt));
    if (c.hash != expected) revert InvalidReveal();

    c.revealed = true;
    _processReveal(msg.sender, value);
}
```

## Pattern Selection Checklist

| Situation | Pattern |
|-----------|---------|
| External calls after state changes | Checks-Effects-Interactions |
| Distributing funds to many users | Pull-over-Push |
| Repeated precondition checks | Guard Check / modifiers |
| Multi-phase protocol flow | State Machine |
| Tiered permissions | Access Restriction |
| Sensitive action prone to front-running | Commit-Reveal |

## Anti-Patterns to Avoid

- Nested external calls within loops
- `tx.origin` for authorization (phishing vector)
- `transfer()` / `send()` for ETH transfers (2300 gas limit breaks with EIP-1884)
- Implicit state transitions without explicit enum tracking
- Boolean flags instead of proper state machines
