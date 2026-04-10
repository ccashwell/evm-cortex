---
name: liquidity-mining
description: Use when implementing liquidity mining programs, LP incentive systems, or MasterChef-style reward distribution. Covers emission schedules, gauge systems, boost mechanics, and reward claiming.
---

# Liquidity Mining Patterns

## MasterChef Architecture

The MasterChef pattern distributes a fixed emission rate across multiple pools, weighted by allocation points. Each pool accrues rewards to its stakers using the Synthetix per-token accumulator.

```
Pool reward rate = totalEmission * pool.allocPoint / totalAllocPoint
User reward = user.amount * (pool.accRewardPerShare - user.rewardDebt)
```

## MasterChef-Style Implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MasterChef is Ownable {
    using SafeERC20 for IERC20;

    struct UserInfo {
        uint256 amount;      // LP tokens staked
        uint256 rewardDebt;  // subtracted from accumulated reward
    }

    struct PoolInfo {
        IERC20 lpToken;
        uint256 allocPoint;
        uint256 lastRewardTime;
        uint256 accRewardPerShare; // scaled by 1e12
    }

    IERC20 public immutable rewardToken;
    uint256 public rewardPerSecond;
    uint256 public totalAllocPoint;

    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    constructor(IERC20 _rewardToken, uint256 _rewardPerSecond) Ownable(msg.sender) {
        rewardToken = _rewardToken;
        rewardPerSecond = _rewardPerSecond;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function addPool(uint256 _allocPoint, IERC20 _lpToken) external onlyOwner {
        totalAllocPoint += _allocPoint;
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardTime: block.timestamp,
            accRewardPerShare: 0
        }));
    }

    function setPool(uint256 _pid, uint256 _allocPoint) external onlyOwner {
        totalAllocPoint = totalAllocPoint - poolInfo[_pid].allocPoint + _allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    function pendingReward(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo memory pool = poolInfo[_pid];
        UserInfo memory user = userInfo[_pid][_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));

        if (block.timestamp > pool.lastRewardTime && lpSupply > 0) {
            uint256 elapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward = elapsed * rewardPerSecond * pool.allocPoint / totalAllocPoint;
            accRewardPerShare += reward * 1e12 / lpSupply;
        }

        return user.amount * accRewardPerShare / 1e12 - user.rewardDebt;
    }

    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.timestamp <= pool.lastRewardTime) return;

        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardTime = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - pool.lastRewardTime;
        uint256 reward = elapsed * rewardPerSecond * pool.allocPoint / totalAllocPoint;
        pool.accRewardPerShare += reward * 1e12 / lpSupply;
        pool.lastRewardTime = block.timestamp;
    }

    function deposit(uint256 _pid, uint256 _amount) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);

        if (user.amount > 0) {
            uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.rewardDebt;
            if (pending > 0) {
                rewardToken.safeTransfer(msg.sender, pending);
            }
        }

        if (_amount > 0) {
            pool.lpToken.safeTransferFrom(msg.sender, address(this), _amount);
            user.amount += _amount;
        }

        user.rewardDebt = user.amount * pool.accRewardPerShare / 1e12;
        emit Deposit(msg.sender, _pid, _amount);
    }

    function withdraw(uint256 _pid, uint256 _amount) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "insufficient balance");
        updatePool(_pid);

        uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.rewardDebt;
        if (pending > 0) {
            rewardToken.safeTransfer(msg.sender, pending);
        }

        if (_amount > 0) {
            user.amount -= _amount;
            pool.lpToken.safeTransfer(msg.sender, _amount);
        }

        user.rewardDebt = user.amount * pool.accRewardPerShare / 1e12;
        emit Withdraw(msg.sender, _pid, _amount);
    }

    function emergencyWithdraw(uint256 _pid) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.lpToken.safeTransfer(msg.sender, amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
}
```

## Emission Schedule Patterns

```solidity
// Halving schedule (like BTC)
function getRewardPerSecond() public view returns (uint256) {
    uint256 epoch = (block.timestamp - startTime) / EPOCH_DURATION;
    return initialRate >> epoch; // halve each epoch
}

// Linear decay
function getRewardPerSecond() public view returns (uint256) {
    uint256 elapsed = block.timestamp - startTime;
    if (elapsed >= totalDuration) return 0;
    return initialRate * (totalDuration - elapsed) / totalDuration;
}
```

## Gauge-Based Allocation

Instead of owner setting allocPoints, let token holders vote on pool weights:

```solidity
mapping(uint256 => uint256) public poolVotes; // pid -> total votes
mapping(address => mapping(uint256 => uint256)) public userVotes;

function vote(uint256 _pid, uint256 _weight) external {
    uint256 votingPower = veToken.balanceOf(msg.sender);
    require(_weight <= votingPower - usedVotes[msg.sender], "exceeded voting power");
    poolVotes[_pid] += _weight;
    userVotes[msg.sender][_pid] += _weight;
    usedVotes[msg.sender] += _weight;
    // allocPoints recalculated from poolVotes at epoch boundaries
}
```

## Checklist

- [ ] `updatePool()` called before any deposit/withdraw
- [ ] `rewardDebt` updated after every balance change
- [ ] `emergencyWithdraw` skips reward calculation (safety valve)
- [ ] Pool allocation changes via `massUpdatePools()` to prevent stale accrual
- [ ] Emission rate accounts for actual reward token balance
- [ ] No duplicate LP token addresses across pools
- [ ] Test reward distribution across multiple users and pools
- [ ] Verify no reward loss from rounding in `accRewardPerShare`
