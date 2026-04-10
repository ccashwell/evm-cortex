---
name: natspec-standards
description: NatSpec documentation standards for Solidity contracts. Use when writing or reviewing contract documentation. Every public and external function must have NatSpec. Covers all tags, formatting conventions, and complete examples.
---

# NatSpec Standards

## Required Documentation

Every public and external function **must** have NatSpec. Internal functions that are non-trivial should also be documented.

## Tags Reference

| Tag | Context | Description |
|-----|---------|-------------|
| `@title` | Contract/interface | Title of the contract |
| `@author` | Contract/interface | Author name or team |
| `@notice` | Contract/function/event/error | User-facing explanation (shown in etherscan) |
| `@dev` | Contract/function/event/error | Developer-facing technical details |
| `@param` | Function/event/error | Describes a parameter |
| `@return` | Function | Describes a return value |
| `@inheritdoc` | Function | Inherits docs from parent contract |
| `@custom:tag` | Any | Custom metadata (e.g., `@custom:security-contact` is mandatory) |

## Contract-Level Documentation

```solidity
/// @title Staking Vault
/// @author Uniswap Labs
/// @notice Handles staking deposits and reward distribution for protocol governance tokens.
/// @dev Uses ERC-4626 vault standard with custom reward distribution.
///      Storage layout is proxy-compatible (see storage-layout skill).
/// @custom:security-contact security@uniswap.org
contract StakingVault is ERC4626, Ownable2Step, ReentrancyGuard {
    // ...
}
```

## Function Documentation

```solidity
/// @notice Deposits tokens into the vault and mints shares to the caller.
/// @dev Follows CEI pattern. Emits {Deposited} event. The share calculation
///      uses the current exchange rate, which may be manipulated in the same
///      block — see economic-attack-vectors for first-depositor defense.
/// @param token The address of the ERC-20 token to deposit.
/// @param amount The amount of tokens to deposit (in token's native decimals).
/// @return shares The number of vault shares minted to the caller.
function deposit(address token, uint256 amount)
    external
    nonReentrant
    whenNotPaused
    returns (uint256 shares)
{
    if (token == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();

    shares = convertToShares(amount);
    _mint(msg.sender, shares);

    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

    emit Deposited(msg.sender, token, amount, shares);
}
```

## Multiple Return Values

Each return value gets its own `@return` tag, in order.

```solidity
/// @notice Returns the position details for a given position ID.
/// @param positionId The unique identifier of the position.
/// @return owner The address that owns the position.
/// @return collateral The amount of collateral deposited (in token decimals).
/// @return debt The amount of debt owed (in token decimals).
/// @return healthFactor The position's health factor (18 decimals, < 1e18 = liquidatable).
function getPosition(uint256 positionId)
    external
    view
    returns (
        address owner,
        uint256 collateral,
        uint256 debt,
        uint256 healthFactor
    )
{
    // ...
}
```

## @inheritdoc

Use `@inheritdoc` to inherit documentation from a parent interface or abstract contract. Add `@dev` for implementation-specific details.

```solidity
interface IVault {
    /// @notice Withdraws tokens by burning vault shares.
    /// @param shares The number of shares to burn.
    /// @return amount The number of tokens returned to the caller.
    function withdraw(uint256 shares) external returns (uint256 amount);
}

contract Vault is IVault {
    /// @inheritdoc IVault
    /// @dev Applies a withdrawal fee of 0.1% (10 bps). The fee is retained
    ///      in the vault, increasing the share price for remaining holders.
    function withdraw(uint256 shares) external override returns (uint256 amount) {
        // ...
    }
}
```

## Event Documentation

```solidity
/// @notice Emitted when a user deposits tokens into the vault.
/// @param user The address of the depositor.
/// @param token The address of the deposited token.
/// @param amount The amount deposited (in token's native decimals).
/// @param shares The number of vault shares minted.
event Deposited(address indexed user, address indexed token, uint256 amount, uint256 shares);
```

## Error Documentation

```solidity
/// @dev Thrown when the oracle price feed returns data older than the staleness threshold.
/// @param feed The address of the Chainlink price feed.
/// @param updatedAt The timestamp of the last price update.
/// @param threshold The maximum allowed age in seconds.
error Oracle_StalePrice(address feed, uint256 updatedAt, uint256 threshold);
```

## Custom Tags

```solidity
/// @custom:security-contact security@protocol.xyz
/// @custom:oz-upgrades-from StakingVaultV1
/// @custom:storage-location erc7201:protocol.storage.StakingVault
contract StakingVaultV2 is StakingVaultV1 {
    // ...
}
```

## Modifier Documentation

```solidity
/// @dev Restricts function access to the designated oracle updater.
///      Reverts with {Unauthorized} if caller is not the updater.
modifier onlyUpdater() {
    if (msg.sender != updater) revert Unauthorized();
    _;
}
```

## Struct Documentation

```solidity
/// @notice Represents a user's staking position.
/// @dev Packed into 2 storage slots (64 bytes). See storage-layout skill.
/// @param amount The staked token amount (18 decimals).
/// @param rewardDebt Used for reward accounting (scaled by ACC_PRECISION).
/// @param lockEnd The timestamp when the lock period expires.
/// @param boostMultiplier The user's boost factor (100 = 1x, 200 = 2x).
struct StakeInfo {
    uint256 amount;
    uint256 rewardDebt;
    uint48 lockEnd;
    uint16 boostMultiplier;
}
```

## NatSpec Checklist

- [ ] Every contract has `@title`, `@author`, `@notice`
- [ ] Every public/external function has `@notice`, `@param`, `@return`
- [ ] Complex functions have `@dev` with implementation details
- [ ] Events have `@notice` and `@param` for each parameter
- [ ] Custom errors have `@dev` explaining trigger conditions
- [ ] `@inheritdoc` used for interface implementations
- [ ] `@custom:security-contact` on all deployable contracts
- [ ] No redundant docs (don't restate what the code obviously does)
- [ ] Units specified in `@param`/`@return` (decimals, bps, seconds)
- [ ] Cross-references to related skills/patterns where helpful
