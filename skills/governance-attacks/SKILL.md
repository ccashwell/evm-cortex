---
name: governance-attacks
description: Governance vulnerabilities and safe design patterns for onchain DAOs. Use when designing or auditing governance systems, voting mechanisms, proposal workflows, or treasury management. Covers flash loan voting, vote buying, proposal griefing, timelock bypass, and quorum manipulation.
---

# Governance Attacks

## Flash Loan Voting

Borrow governance tokens → acquire voting power → vote → return tokens. All in one transaction.

```
1. Flash borrow 10M GOV tokens
2. Delegate to self (if not already delegated)
3. Cast vote on active proposal
4. Return tokens
```

### Defense: Snapshot-Based Voting

```solidity
contract SafeGovernor {
    // Voting power is snapshotted BEFORE proposal voting begins
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public returns (uint256 proposalId) {
        uint256 snapshot = block.number + votingDelay;
        // votingDelay ensures tokens must be held before voting starts
        proposals[proposalId].snapshot = snapshot;
        proposals[proposalId].deadline = snapshot + votingPeriod;
        // ...
    }

    function _getVotes(address account, uint256 blockNumber)
        internal
        view
        returns (uint256)
    {
        // Historical balance — flash loans have zero effect
        return token.getPastVotes(account, blockNumber);
    }
}
```

### Key Parameters

```solidity
uint256 public votingDelay = 1 days;     // blocks between propose and vote start
uint256 public votingPeriod = 1 weeks;   // duration of voting
uint256 public proposalThreshold = 100_000e18; // tokens needed to propose
```

## Vote Buying / Dark DAOs

Off-chain vote buying markets where token holders sell their voting power.

```
1. Attacker deploys contract: "Deposit GOV tokens, vote my way, earn rewards"
2. Token holders delegate to attacker's contract
3. Attacker controls large voting block
```

### Defense: Vote Escrow (veToken)

```solidity
// Voters must lock tokens for extended periods to gain voting power
// Makes vote buying expensive (capital must be locked, not just held momentarily)
struct LockInfo {
    uint256 amount;
    uint256 unlockTime;
}

function getVotingPower(address account) public view returns (uint256) {
    LockInfo memory lock = locks[account];
    if (lock.unlockTime <= block.timestamp) return 0;

    // Voting power decays linearly toward unlock
    uint256 timeRemaining = lock.unlockTime - block.timestamp;
    uint256 maxLockDuration = 4 * 365 days;

    return lock.amount * timeRemaining / maxLockDuration;
}
```

## Proposal Griefing

Spamming proposals to exhaust voter attention or bloat governance systems.

```solidity
// VULNERABLE: low proposal threshold
function propose(...) external {
    require(getVotes(msg.sender) >= proposalThreshold);
    // proposalThreshold = 1 token → anyone can spam proposals
}

// DEFENSE: meaningful proposal threshold + proposal deposit
uint256 public proposalThreshold = 100_000e18; // 0.1% of supply
uint256 public proposalDeposit = 10 ether;

mapping(uint256 => address) public proposalDepositors;

function propose(...) external payable returns (uint256 proposalId) {
    if (getVotes(msg.sender) < proposalThreshold) revert BelowThreshold();
    if (msg.value < proposalDeposit) revert InsufficientDeposit();

    proposalId = _createProposal(...);
    proposalDepositors[proposalId] = msg.sender;
}

// Refund deposit if proposal passes or is not spam
function refundDeposit(uint256 proposalId) external {
    if (state(proposalId) != ProposalState.Succeeded &&
        state(proposalId) != ProposalState.Executed) {
        revert ProposalNotSucceeded();
    }
    payable(proposalDepositors[proposalId]).call{value: proposalDeposit}("");
}
```

## Timelock Bypass

Governance proposals typically execute through a timelock. Attacks that bypass or shorten the timelock.

```solidity
// Attack: propose to reduce timelock delay to 0, then execute malicious proposals
// Defense: minimum timelock delay is hardcoded, not governable

contract SafeTimelock {
    uint256 public constant MINIMUM_DELAY = 2 days;
    uint256 public constant MAXIMUM_DELAY = 30 days;

    function setDelay(uint256 newDelay) external onlySelf {
        if (newDelay < MINIMUM_DELAY) revert DelayTooShort();
        if (newDelay > MAXIMUM_DELAY) revert DelayTooLong();
        delay = newDelay;
    }
}
```

### Emergency Guardian

```solidity
// Guardian can veto proposals but cannot execute them
// Provides a safety net without centralization risk
address public guardian;

function veto(uint256 proposalId) external {
    if (msg.sender != guardian) revert NotGuardian();
    if (state(proposalId) == ProposalState.Executed) revert AlreadyExecuted();

    proposals[proposalId].vetoed = true;
    emit ProposalVetoed(proposalId, msg.sender);
}

// Guardian power can be revoked by governance after sufficient decentralization
function renounceGuardian() external {
    if (msg.sender != guardian) revert NotGuardian();
    guardian = address(0);
    emit GuardianRenounced();
}
```

## Delegation Manipulation

Exploiting delegation mechanics for concentrated voting power.

```solidity
// Attack: create many accounts, receive airdrop, delegate all to one address
// Defense: identity verification for airdrops is hard onchain

// Attack: delegate, vote, undelegate, re-delegate to another proposal
// Defense: delegation snapshot at proposal creation time
function delegate(address delegatee) external {
    _delegate(msg.sender, delegatee);
    // Checkpointing ensures changes don't affect active proposals
}
```

## Quorum Manipulation

Reducing effective quorum by increasing total supply or burning opposing votes.

```solidity
// VULNERABLE: quorum as percentage of totalSupply at vote time
function quorumReached(uint256 proposalId) public view returns (bool) {
    return proposalVotes[proposalId].forVotes >= totalSupply() * quorumPct / 100;
    // totalSupply can change between proposal and vote
}

// SAFE: quorum as absolute number, snapshotted at proposal creation
function quorumReached(uint256 proposalId) public view returns (bool) {
    uint256 snapshot = proposals[proposalId].snapshot;
    uint256 quorum = token.getPastTotalSupply(snapshot) * quorumPct / 100;
    return proposalVotes[proposalId].forVotes >= quorum;
}
```

## Safe Governance Design Template

```solidity
// Recommended parameters for production governance
struct GovernanceConfig {
    uint256 votingDelay;          // 1-2 days
    uint256 votingPeriod;         // 5-7 days
    uint256 proposalThreshold;    // 0.1-1% of supply
    uint256 quorumPercentage;     // 4-10% of supply
    uint256 timelockDelay;        // 2-7 days
    bool snapshotVoting;          // always true
    bool guardianEnabled;         // true until sufficiently decentralized
}
```

## Governance Security Checklist

- [ ] Snapshot-based voting (historical balances, not current)
- [ ] Meaningful voting delay (1+ days between propose and vote start)
- [ ] Proposal threshold prevents spam (0.1%+ of supply)
- [ ] Timelock on execution with hardcoded minimum delay
- [ ] Quorum calculated from snapshotted total supply
- [ ] Guardian/veto mechanism for emergency response
- [ ] Vote escrow (veToken) for sustained commitment
- [ ] Proposal deposit to disincentivize griefing
- [ ] Delegation changes checkpointed (no retroactive manipulation)
- [ ] Treasury operations behind timelock with multi-sig
