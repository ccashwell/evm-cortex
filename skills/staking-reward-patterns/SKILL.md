---
name: staking-reward-patterns
description: Use when implementing staking contracts, reward distribution systems, or yield farming. Covers the Synthetix reward model, per-second accrual, cooldown periods, and boosted reward mechanics.
---

# Staking & Reward Distribution Patterns

## Synthetix Reward Model

The industry-standard approach for distributing rewards proportionally to stakers without iterating over all stakers. Gas cost is O(1) per user action.

**Core formula**:
```
rewardPerToken = rewardPerToken + (elapsed * rewardRate / totalStaked)
earned(user) = balance(user) * (rewardPerToken - userRewardPerTokenPaid(user)) + rewards(user)
```

## Synthetix-Style Reward Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StakingRewards is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    address public rewardDistributor;

    uint256 public rewardRate;        // rewards per second
    uint256 public periodFinish;      // when current reward period ends
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 public constant DURATION = 7 days;

    constructor(address _stakingToken, address _rewardToken, address _distributor) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = _distributor;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / totalSupply
        );
    }

    function earned(address account) public view returns (uint256) {
        return (
            balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18
        ) + rewards[account];
    }

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(balanceOf[msg.sender]);
        claim();
    }

    function notifyRewardAmount(uint256 reward)
        external
        updateReward(address(0))
    {
        require(msg.sender == rewardDistributor, "unauthorized");

        if (block.timestamp >= periodFinish) {
            rewardRate = reward / DURATION;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / DURATION;
        }

        require(rewardRate > 0, "reward rate = 0");
        require(
            rewardRate * DURATION <= rewardToken.balanceOf(address(this)),
            "reward amount > balance"
        );

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + DURATION;
        emit RewardAdded(reward);
    }

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward);
}
```

## Cooldown Period Pattern

```solidity
uint256 public constant COOLDOWN_DURATION = 10 days;
uint256 public constant UNSTAKE_WINDOW = 2 days;

mapping(address => uint256) public cooldownStart;

function startCooldown() external {
    require(balanceOf[msg.sender] > 0, "nothing staked");
    cooldownStart[msg.sender] = block.timestamp;
}

function withdraw(uint256 amount) external {
    uint256 cooldown = cooldownStart[msg.sender];
    require(cooldown > 0, "cooldown not started");
    require(block.timestamp >= cooldown + COOLDOWN_DURATION, "cooldown active");
    require(
        block.timestamp <= cooldown + COOLDOWN_DURATION + UNSTAKE_WINDOW,
        "unstake window closed"
    );
    cooldownStart[msg.sender] = 0;
    // ... transfer logic
}
```

## Reward Boosting (ve-Style)

```solidity
// Boost based on lock duration: longer lock = higher multiplier
function getBoost(address user) public view returns (uint256) {
    uint256 lockEnd = lockEndTime[user];
    if (lockEnd <= block.timestamp) return 1e18; // 1x (no boost)
    uint256 remaining = lockEnd - block.timestamp;
    uint256 maxDuration = 4 * 365 days;
    // Linear boost: 1x to 2.5x based on lock duration
    return 1e18 + (remaining * 15e17 / maxDuration);
}

function earned(address account) public view returns (uint256) {
    uint256 base = balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18;
    return (base * getBoost(account) / 1e18) + rewards[account];
}
```

## Checklist

- [ ] Use `updateReward` modifier on every state-changing function
- [ ] `rewardPerToken()` handles `totalSupply == 0` (avoid division by zero)
- [ ] `notifyRewardAmount` checks sufficient reward token balance
- [ ] Reward rate calculation handles mid-period top-ups correctly
- [ ] Apply `ReentrancyGuard` on stake/withdraw/claim
- [ ] Use `SafeERC20` for all token transfers
- [ ] Consider cooldown period for protocol safety
- [ ] Test reward accrual across multiple stakers and time periods
- [ ] Verify no reward dust is lost due to integer division
