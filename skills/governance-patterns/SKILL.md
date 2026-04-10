---
name: governance-patterns
description: Use when implementing onchain governance, DAO voting systems, or timelock-controlled execution. Covers OpenZeppelin Governor, TimelockController, voting strategies, quorum calculations, and proposal lifecycle.
---

# Onchain Governance Patterns

## Governor Lifecycle

```
propose() -> Active (voting) -> Succeeded -> queue() -> Queued (timelock) -> execute()
                              -> Defeated (quorum not met or majority against)
         -> Canceled (by proposer before execution)
```

## OpenZeppelin Governor Setup

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

contract MyGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    constructor(
        IVotes _token,
        TimelockController _timelock
    )
        Governor("MyGovernor")
        GovernorSettings(
            7200,    // votingDelay: 1 day in blocks (12s blocks)
            50400,   // votingPeriod: 1 week in blocks
            100e18   // proposalThreshold: 100 tokens to propose
        )
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4) // 4% quorum
        GovernorTimelockControl(_timelock)
    {}

    // Required overrides for Solidity
    function votingDelay() public view override(Governor, GovernorSettings)
        returns (uint256) { return super.votingDelay(); }

    function votingPeriod() public view override(Governor, GovernorSettings)
        returns (uint256) { return super.votingPeriod(); }

    function quorum(uint256 blockNumber) public view override(Governor, GovernorVotesQuorumFraction)
        returns (uint256) { return super.quorum(blockNumber); }

    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl)
        returns (ProposalState) { return super.state(proposalId); }

    function proposalThreshold() public view override(Governor, GovernorSettings)
        returns (uint256) { return super.proposalThreshold(); }

    function proposalNeedsQueuing(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (bool)
    { return super.proposalNeedsQueuing(proposalId); }

    function _queueOperations(uint256 id, address[] memory t, uint256[] memory v,
        bytes[] memory c, bytes32 h) internal override(Governor, GovernorTimelockControl)
        returns (uint48) { return super._queueOperations(id, t, v, c, h); }

    function _executeOperations(uint256 id, address[] memory t, uint256[] memory v,
        bytes[] memory c, bytes32 h) internal override(Governor, GovernorTimelockControl)
    { super._executeOperations(id, t, v, c, h); }

    function _cancel(address[] memory t, uint256[] memory v, bytes[] memory c, bytes32 h)
        internal override(Governor, GovernorTimelockControl) returns (uint256)
    { return super._cancel(t, v, c, h); }

    function _executor() internal view override(Governor, GovernorTimelockControl)
        returns (address) { return super._executor(); }
}
```

## TimelockController Deployment

```solidity
uint256 minDelay = 2 days;
address[] memory proposers = new address[](1);
address[] memory executors = new address[](1);

proposers[0] = address(0); // will be set to governor
executors[0] = address(0); // anyone can execute after delay

TimelockController timelock = new TimelockController(
    minDelay, proposers, executors, msg.sender
);

MyGovernor governor = new MyGovernor(token, timelock);

// Grant governor proposer and canceller roles
timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));

// Revoke deployer's admin role
timelock.revokeRole(timelock.DEFAULT_ADMIN_ROLE(), msg.sender);
```

## Proposal Creation and Execution

```solidity
// Create proposal
address[] memory targets = new address[](1);
uint256[] memory values = new uint256[](1);
bytes[] memory calldatas = new bytes[](1);

targets[0] = address(treasury);
values[0] = 0;
calldatas[0] = abi.encodeCall(Treasury.transfer, (recipient, amount));

uint256 proposalId = governor.propose(targets, values, calldatas, "Fund development team");

// Vote (after votingDelay)
governor.castVote(proposalId, 1); // 0=Against, 1=For, 2=Abstain

// Queue (after votingPeriod, if succeeded)
governor.queue(targets, values, calldatas, keccak256("Fund development team"));

// Execute (after timelock delay)
governor.execute(targets, values, calldatas, keccak256("Fund development team"));
```

## Governance Token with Votes

```solidity
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract GovToken is ERC20, ERC20Permit, ERC20Votes {
    constructor() ERC20("GovToken", "GOV") ERC20Permit("GovToken") {}

    // Users must delegate to activate voting power (even self-delegate)
    // token.delegate(msg.sender) to self-delegate
}
```

## Parameter Guidelines

| Parameter | Conservative | Moderate | Aggressive |
|-----------|-------------|----------|------------|
| Voting Delay | 2 days | 1 day | 1 block |
| Voting Period | 2 weeks | 1 week | 3 days |
| Proposal Threshold | 1% supply | 0.1% supply | 0 |
| Quorum | 10% supply | 4% supply | 2% supply |
| Timelock Delay | 7 days | 2 days | 1 day |

## Checklist

- [ ] Token holders must delegate (self-delegate) to activate voting power
- [ ] Timelock admin role revoked from deployer after setup
- [ ] Governor has PROPOSER and CANCELLER roles on timelock
- [ ] Quorum fraction is appropriate for expected participation
- [ ] Voting delay gives time for delegation before voting starts
- [ ] Proposal description is hashed consistently for queue/execute
- [ ] Test full lifecycle: propose -> vote -> queue -> execute
- [ ] Consider emergency mechanisms (guardian multisig as canceller)
