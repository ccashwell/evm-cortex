---
name: economic-attack-vectors
description: Economic attack vectors and defenses for DeFi protocols. Use when designing vaults, lending pools, AMMs, or any system with share-based accounting. Covers first depositor inflation, donation attacks, sandwich attacks on liquidity, JIT liquidity, and flash loan leveraged attacks.
---

# Economic Attack Vectors

## First Depositor Inflation Attack (ERC-4626)

The most common vault attack. The first depositor can manipulate the share price to steal from subsequent depositors.

### Attack Steps

```
1. Attacker deposits 1 wei → receives 1 share
2. Attacker donates 1e18 tokens directly to vault (not via deposit)
3. Vault state: 1 share, (1 + 1e18) assets
4. Victim deposits 1.5e18 tokens
5. Shares minted = 1.5e18 * 1 / (1 + 1e18) = 0 shares (rounds to 0)
6. Attacker redeems 1 share → gets all 2.5e18 tokens
7. Victim loses ~1.5e18 tokens
```

### Defense: Virtual Shares and Assets

```solidity
contract SafeVault is ERC4626 {
    uint256 private constant VIRTUAL_SHARES = 1e3;   // 1000 virtual shares
    uint256 private constant VIRTUAL_ASSETS = 1;     // 1 virtual asset

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + VIRTUAL_ASSETS;
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 3; // adds 1e3 virtual shares
    }
}
```

### Defense: Minimum Initial Deposit

```solidity
uint256 public constant MIN_INITIAL_DEPOSIT = 1e6; // 1 USDC or equivalent

function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
    if (totalSupply() == 0 && assets < MIN_INITIAL_DEPOSIT) {
        revert InitialDepositTooSmall();
    }
    return super.deposit(assets, receiver);
}
```

### Defense: Dead Shares

Lock a small amount of shares on first deposit to establish a non-manipulable base.

```solidity
function _afterDeposit(uint256 assets, uint256 shares) internal override {
    if (totalSupply() == shares) {
        // First deposit — burn some shares to dead address
        uint256 deadShares = 1e3;
        _mint(address(0xdead), deadShares);
    }
}
```

## Donation Attack

An attacker sends tokens directly to a contract (via `transfer`, not `deposit`) to manipulate internal accounting.

```solidity
// VULNERABLE: relies on balanceOf for accounting
function getExchangeRate() public view returns (uint256) {
    return IERC20(asset).balanceOf(address(this)) / totalShares;
    // Attacker can inflate by donating tokens
}

// SAFE: track deposits explicitly
uint256 public totalManagedAssets;

function deposit(uint256 amount) external {
    totalManagedAssets += amount;
    IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
}

function getExchangeRate() public view returns (uint256) {
    return totalManagedAssets / totalShares; // not manipulable via donation
}
```

## Share Price Manipulation

Manipulating the share price (assets per share) to extract value.

```solidity
// Attack on lending protocol:
// 1. Deposit collateral, borrow assets
// 2. Donate to vault → inflate share price
// 3. Collateral (measured in shares) appears more valuable
// 4. Borrow more than collateral is worth
// 5. Default on the loan

// Defense: use internal accounting, not balanceOf
// Defense: price oracle for share valuation (not instantaneous price)
```

## Sandwich Attacks on Liquidity Provision

```
1. Attacker sees victim's addLiquidity TX in mempool
2. Front-run: large swap moves the price
3. Victim adds liquidity at skewed ratio
4. Back-run: attacker swaps back, profiting from the imbalance
```

### Defense

```solidity
function addLiquidity(
    uint256 amount0Desired,
    uint256 amount1Desired,
    uint256 amount0Min,     // minimum token0 actually deposited
    uint256 amount1Min,     // minimum token1 actually deposited
    uint256 deadline
) external returns (uint256 liquidity) {
    if (block.timestamp > deadline) revert Expired();

    (uint256 amount0, uint256 amount1) = _calculateOptimalAmounts(
        amount0Desired, amount1Desired
    );

    if (amount0 < amount0Min) revert InsufficientAmount0();
    if (amount1 < amount1Min) revert InsufficientAmount1();

    // ...
}
```

## Just-in-Time (JIT) Liquidity

MEV searchers add concentrated liquidity just before a large swap and remove it immediately after, capturing swap fees without taking long-term IL risk.

```solidity
// Defense: time-weighted fee distribution
mapping(uint256 => uint256) public positionMintBlock;

function collectFees(uint256 positionId) external {
    uint256 mintBlock = positionMintBlock[positionId];
    uint256 blocksActive = block.number - mintBlock;

    if (blocksActive < MIN_ACTIVE_BLOCKS) {
        revert PositionTooNew(blocksActive, MIN_ACTIVE_BLOCKS);
    }
    // Fees are proportional to time * liquidity, not just liquidity
}
```

## Flash Loan Leveraged Attacks

Flash loans amplify any profitable attack by providing unlimited capital.

```solidity
// Generic pattern:
// 1. Flash borrow X tokens
// 2. Use X to manipulate state (price, governance, collateral)
// 3. Extract profit from manipulated state
// 4. Return X + fee

// Defense principle: any state that can be profitably manipulated
// with temporary capital must be resistant to single-block manipulation

// Specific defenses:
// - Time-weighted readings (TWAP, voting snapshots)
// - Multi-block delays (deposit → borrow separation)
// - Rate limiting (max action per block)
```

## Governance Token Economic Attacks

```solidity
// Attack: borrow governance tokens → propose + vote → drain treasury
// Defense: snapshot voting + proposal threshold + voting delay

// Attack: buy tokens → vote → dump tokens
// Defense: time-locked voting power (must hold tokens for N blocks)

function getVotingPower(address account) public view returns (uint256) {
    uint256 balance = token.balanceOf(account);
    uint256 holdDuration = block.number - firstPurchaseBlock[account];

    if (holdDuration < MIN_HOLD_BLOCKS) return 0;

    // Optional: voting power scales with hold time
    uint256 multiplier = Math.min(holdDuration / BLOCKS_PER_MONTH, MAX_MULTIPLIER);
    return balance * multiplier / MAX_MULTIPLIER;
}
```

## Economic Attack Defense Checklist

- [ ] ERC-4626 vaults use virtual shares/assets or dead shares
- [ ] No reliance on `balanceOf` for internal accounting
- [ ] Minimum deposit amounts to prevent dust attacks
- [ ] Liquidity provision has slippage protection (minAmount0, minAmount1)
- [ ] Deadline parameters on all value-sensitive operations
- [ ] Share price not manipulable via direct token transfers
- [ ] Governance uses snapshot voting with minimum hold periods
- [ ] Flash loan amplifiable state changes have multi-block delays
- [ ] Rate limiting on critical operations (max per block/epoch)
