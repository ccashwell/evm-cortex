---
name: usdc-integration
description: Use when integrating USDC into smart contracts, handling stablecoin transfers, approvals, or checking balances. Covers the 6-decimal rule, production contract addresses on all major chains, native vs bridged USDC variants, FiatTokenV2_2 proxy architecture, permit (EIP-2612), blocklist behavior, and safe integration patterns.
---

# USDC Integration for Smart Contracts

## The 6-Decimal Rule

USDC uses 6 decimals on every chain. Not 18. This is the single most common integration bug.

```solidity
// 1 USDC = 1_000_000 (1e6)
uint256 constant USDC_UNIT = 1e6;

// $100 USDC
uint256 amount = 100 * 1e6; // 100_000_000

// $0.01 USDC (one cent)
uint256 oneCent = 1e4; // 10_000

// WRONG — this is 1 trillion USDC ($1,000,000,000,000)
uint256 catastrophic = 1e18;
```

### Decimal Conversion

When protocols mix USDC (6 decimals) with 18-decimal tokens (WETH, DAI, most ERC-20s), explicit scaling is required:

```solidity
uint256 constant SCALE_FACTOR = 1e12; // 18 - 6 = 12

// Scale 6 → 18 (lossless)
uint256 wad = usdcAmount * SCALE_FACTOR;

// Scale 18 → 6 (LOSES up to 1e12 - 1 wei of precision)
uint256 usdc = wadAmount / SCALE_FACTOR;
```

Never scale in a single arithmetic expression without isolating the conversion. Multiply before dividing to preserve precision:

```solidity
// BAD — precision loss compounds
uint256 result = (usdcAmount * price) / 1e18;

// BETTER — scale USDC to 18 decimals first, then divide
uint256 result = (usdcAmount * SCALE_FACTOR * price) / 1e18;

// BEST — use a helper that makes intent explicit
uint256 result = _toWad(usdcAmount) * price / 1e18;
```

## Production Contract Addresses

### Mainnet — Native (Circle-issued) USDC

These are the canonical addresses issued directly by Circle via CCTP. All are FiatTokenV2_2 proxies.

| Chain | Address | Chain ID |
|-------|---------|----------|
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 1 |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 8453 |
| Arbitrum One | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 42161 |
| Optimism | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 10 |
| Polygon PoS | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 137 |
| Avalanche C-Chain | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 43114 |
| Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | — |

### Testnet Addresses

| Chain | Address |
|-------|---------|
| Ethereum Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Arbitrum Sepolia | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Optimism Sepolia | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` |
| Polygon Amoy | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |
| Avalanche Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` |

Testnet faucet: https://faucet.circle.com

### Verifying Addresses Onchain

Never hardcode addresses from documentation alone. Verify with `cast`:

```bash
# Confirm USDC contract exists and is a proxy
cast code 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --rpc-url mainnet | head -c 40

# Check decimals
cast call 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 "decimals()(uint8)" --rpc-url mainnet
# → 6

# Check symbol
cast call 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 "symbol()(string)" --rpc-url mainnet
# → "USDC"
```

## Native USDC vs Bridged Variants

Always use native Circle-issued USDC. Bridged variants are deprecated and lack features like permit, blocklist enforcement, and CCTP support.

### Deprecated Bridged Tokens — DO NOT USE

| Token | Chain | Address | Status |
|-------|-------|---------|--------|
| USDbC | Base | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Ca` | Deprecated |
| USDC.e | Arbitrum | `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8` | Deprecated |
| USDC.e | Avalanche | `0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664` | Deprecated |
| USDC.e | Polygon | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | Deprecated |
| USDC.e | Optimism | `0x7F5c764cBc14f9669B88837ca1490cCa17c31607` | Deprecated |

### Detecting Native vs Bridged at Runtime

```solidity
/// @notice Validates that a USDC address is the native Circle-issued token
/// @dev Checks for EIP-2612 permit support as a heuristic — bridged variants lack it
function _validateNativeUSDC(address token) internal view {
    // Native USDC supports EIP-2612 permit via DOMAIN_SEPARATOR
    (bool success,) = token.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
    if (!success) revert NotNativeUSDC(token);
}
```

For deploy-time validation, pass the expected chain-specific address as a constructor argument and verify `decimals() == 6` plus `symbol` matches.

## FiatTokenV2_2 Architecture

USDC is not a simple ERC-20. It is a proxied, upgradeable, regulated stablecoin.

### Proxy Structure

```
FiatTokenProxy (storage + delegatecall)
  └── FiatTokenV2_2 (implementation logic)
        ├── ERC-20 (transfer, approve, transferFrom, balanceOf, allowance)
        ├── EIP-2612 (permit — gasless approvals via signature)
        ├── EIP-3009 (transferWithAuthorization, receiveWithAuthorization)
        ├── Blocklist (Circle can block specific addresses)
        ├── Pause (Circle can halt all transfers globally)
        └── Upgrade (Circle can swap the implementation)
```

### Key Administrative Roles

| Role | Capability |
|------|-----------|
| Admin | Upgrade implementation, change admin |
| Master Minter | Configure minters, set minting allowances |
| Blocklister | Add/remove addresses from blocklist |
| Pauser | Pause and unpause all transfers |
| Rescuer | Recover tokens accidentally sent to the USDC contract |

### Implications for Protocol Design

1. **Blocklist**: Any address can be blocklisted at any time. If a blocklisted address holds a position in your protocol, `transfer` and `transferFrom` to/from that address will revert.
2. **Pause**: All USDC transfers can be halted globally. Liquidation mechanisms that depend on USDC transfers will fail during a pause.
3. **Upgrade**: The implementation can change. Interface compatibility is maintained, but new behaviors (additional checks, storage changes) can be introduced.

## Safe Integration Patterns

### Basic Deposit/Withdraw

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title USDCVault
/// @notice Minimal vault demonstrating safe USDC integration
contract USDCVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;

    mapping(address user => uint256 balance) public balances;

    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, address indexed recipient, uint256 amount);

    constructor(address usdc_) {
        USDC = IERC20(usdc_);
    }

    /// @notice Deposit USDC into the vault
    /// @param amount Amount of USDC in 6-decimal units
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);

        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Withdraw USDC to a specified recipient
    /// @dev Allows withdrawal to a different address in case msg.sender is blocklisted
    /// @param recipient Address to receive USDC
    /// @param amount Amount of USDC in 6-decimal units
    function withdraw(address recipient, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balances[msg.sender];
        if (bal < amount) revert InsufficientBalance(bal, amount);

        balances[msg.sender] = bal - amount;
        emit Withdrawn(msg.sender, recipient, amount);

        USDC.safeTransfer(recipient, amount);
    }
}
```

### Permit Integration (Gasless Approvals)

USDC natively supports EIP-2612 `permit`, allowing users to approve and deposit in a single transaction without a prior `approve` call.

```solidity
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @notice Deposit with a signed permit, enabling single-tx approve + deposit
/// @param amount USDC amount (6 decimals)
/// @param deadline Timestamp after which the permit signature expires
/// @param v Recovery byte of the permit signature
/// @param r First 32 bytes of the permit signature
/// @param s Second 32 bytes of the permit signature
function depositWithPermit(
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
) external nonReentrant {
    if (amount == 0) revert ZeroAmount();

    // permit may revert if signature is invalid or already used
    try IERC20Permit(address(USDC)).permit(
        msg.sender, address(this), amount, deadline, v, r, s
    ) {} catch {
        // Permit may fail if:
        // 1. Approval already exists (front-run or user pre-approved)
        // 2. Signature was already used
        // Proceed with transferFrom — it will fail if allowance is insufficient
    }

    balances[msg.sender] += amount;
    emit Deposited(msg.sender, amount);

    USDC.safeTransferFrom(msg.sender, address(this), amount);
}
```

The `try/catch` around `permit` is intentional. If a permit signature is front-run (someone else submits it first), the approval still exists and `transferFrom` succeeds. Reverting on a failed `permit` would brick the transaction unnecessarily.

### EIP-3009: transferWithAuthorization

USDC also supports EIP-3009 for authorized transfers. Unlike `permit` + `transferFrom`, this combines authorization and transfer atomically:

```solidity
interface IFiatTokenV2 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
```

`receiveWithAuthorization` enforces `msg.sender == to`, preventing front-running of the authorization. Prefer it over `transferWithAuthorization` when the recipient is your contract.

## Handling Blocklist Scenarios

### The Problem

A user deposits USDC into your protocol. Later, Circle blocklists their address. Now:
- `USDC.transfer(blockedUser, amount)` reverts
- The user cannot withdraw
- If the user has a liquidatable position, liquidation may also revert

### Defense Patterns

```solidity
/// @notice Withdraw to an alternative recipient if the depositor is blocklisted
/// @dev Access-controlled so only the original depositor can redirect
function withdraw(address recipient, uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();
    uint256 bal = balances[msg.sender];
    if (bal < amount) revert InsufficientBalance(bal, amount);

    balances[msg.sender] = bal - amount;
    emit Withdrawn(msg.sender, recipient, amount);

    USDC.safeTransfer(recipient, amount);
}
```

For lending protocols where liquidation is critical:

```solidity
/// @notice Liquidate a position, sending seized USDC to the liquidator
/// @dev If the direct transfer fails (blocklist), escrow the funds
function liquidate(address borrower, uint256 repayAmount) external nonReentrant {
    // ... checks and effects ...

    uint256 seizedCollateral = _calculateSeizedCollateral(repayAmount);
    balances[borrower] -= seizedCollateral;

    // Attempt direct transfer; fall back to escrow on failure
    try IERC20(address(USDC)).transfer(msg.sender, seizedCollateral) {
        emit Liquidated(borrower, msg.sender, seizedCollateral);
    } catch {
        pendingWithdrawals[msg.sender] += seizedCollateral;
        emit LiquidatedToEscrow(borrower, msg.sender, seizedCollateral);
    }
}

/// @notice Claim escrowed funds from a failed liquidation transfer
function claimEscrow(address recipient) external nonReentrant {
    uint256 amount = pendingWithdrawals[msg.sender];
    if (amount == 0) revert NothingToClaim();
    pendingWithdrawals[msg.sender] = 0;
    USDC.safeTransfer(recipient, amount);
}
```

### Handling Global Pause

```solidity
/// @notice Check if USDC is currently paused
/// @dev Useful for UIs or circuits that need to know transfer availability
function isUSDCPaused() public view returns (bool) {
    (bool success, bytes memory data) = address(USDC).staticcall(
        abi.encodeWithSignature("paused()")
    );
    return success && abi.decode(data, (bool));
}
```

## Decimal Conversion Library

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title USDCLib
/// @notice Helpers for USDC decimal conversions
library USDCLib {
    uint256 internal constant USDC_DECIMALS = 6;
    uint256 internal constant USDC_UNIT = 1e6;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant SCALE_FACTOR = 1e12;

    /// @notice Convert USDC amount (6 decimals) to WAD (18 decimals)
    /// @dev Lossless — always safe
    function toWad(uint256 usdcAmount) internal pure returns (uint256) {
        return usdcAmount * SCALE_FACTOR;
    }

    /// @notice Convert WAD (18 decimals) to USDC amount (6 decimals)
    /// @dev Truncates — loses up to 999_999_999_999 wei (< $0.000001)
    function fromWad(uint256 wadAmount) internal pure returns (uint256) {
        return wadAmount / SCALE_FACTOR;
    }

    /// @notice Convert WAD to USDC, rounding up
    /// @dev Use when the protocol should not lose value (e.g., debt calculations)
    function fromWadRoundUp(uint256 wadAmount) internal pure returns (uint256) {
        return (wadAmount + SCALE_FACTOR - 1) / SCALE_FACTOR;
    }

    /// @notice Construct a USDC amount from whole dollars
    function dollars(uint256 amount) internal pure returns (uint256) {
        return amount * USDC_UNIT;
    }

    /// @notice Construct a USDC amount from dollars and cents
    function dollarsAndCents(uint256 wholeDollars, uint256 cents) internal pure returns (uint256) {
        return wholeDollars * USDC_UNIT + cents * 1e4;
    }
}
```

## Testing with USDC on Forks

### Fork Mainnet Setup

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract USDCForkTest is Test {
    IERC20 constant USDC = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.createSelectFork("mainnet");

        // deal() works for setting USDC balances on forks
        deal(address(USDC), alice, 1_000_000 * 1e6); // $1M
        deal(address(USDC), bob, 500_000 * 1e6);      // $500K
    }

    function test_usdcDecimals() public view {
        assertEq(USDC.decimals(), 6);
    }

    function test_transfer() public {
        vm.prank(alice);
        USDC.transfer(bob, 100 * 1e6); // $100

        assertEq(USDC.balanceOf(bob), 600_000 * 1e6);
    }
}
```

### Testing Blocklist Behavior

```solidity
function test_blocklistedAddressCannotReceive() public {
    address blocklister = 0x5dB0115f3B72d19cEa34dD697cf412Ff86dc7E1b;
    address victim = makeAddr("victim");

    deal(address(USDC), alice, 100 * 1e6);

    // Blocklist the victim address
    vm.prank(blocklister);
    (bool success,) = address(USDC).call(
        abi.encodeWithSignature("blacklist(address)", victim)
    );
    assertTrue(success);

    // Transfer to blocklisted address reverts
    vm.prank(alice);
    vm.expectRevert();
    USDC.transfer(victim, 50 * 1e6);
}
```

### Testing Permit Signatures

```solidity
function test_permitAndDeposit() public {
    uint256 alicePk = 0xA11CE;
    address aliceAddr = vm.addr(alicePk);
    deal(address(USDC), aliceAddr, 1000 * 1e6);

    uint256 amount = 500 * 1e6;
    uint256 deadline = block.timestamp + 1 hours;

    // Build permit digest
    bytes32 domainSeparator = IERC20Permit(address(USDC)).DOMAIN_SEPARATOR();
    bytes32 structHash = keccak256(abi.encode(
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
        aliceAddr,
        address(vault),
        amount,
        IERC20Permit(address(USDC)).nonces(aliceAddr),
        deadline
    ));
    bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

    (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

    vm.prank(aliceAddr);
    vault.depositWithPermit(amount, deadline, v, r, s);

    assertEq(vault.balances(aliceAddr), amount);
}
```

### Multichain Fork Testing

```solidity
function test_usdcOnMultipleChains() public {
    // Ethereum
    uint256 ethFork = vm.createFork("mainnet");
    vm.selectFork(ethFork);
    assertEq(
        IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48).decimals(),
        6
    );

    // Base
    uint256 baseFork = vm.createFork("base");
    vm.selectFork(baseFork);
    assertEq(
        IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).decimals(),
        6
    );

    // Arbitrum
    uint256 arbFork = vm.createFork("arbitrum");
    vm.selectFork(arbFork);
    assertEq(
        IERC20(0xaf88d065e77c8cC2239327C5EDb3A432268e5831).decimals(),
        6
    );
}
```

## Multichain Deployment Pattern

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title USDCRegistry
/// @notice Deploy-time registry that validates the USDC address for the target chain
contract USDCRegistry {
    error InvalidUSDCDecimals(uint8 actual);
    error InvalidUSDCSymbol(string actual);
    error ChainMismatch(uint256 expected, uint256 actual);

    IERC20 public immutable USDC;
    uint256 public immutable EXPECTED_CHAIN_ID;

    constructor(address usdc_, uint256 expectedChainId_) {
        if (block.chainid != expectedChainId_) {
            revert ChainMismatch(expectedChainId_, block.chainid);
        }

        uint8 decimals = IERC20Metadata(usdc_).decimals();
        if (decimals != 6) revert InvalidUSDCDecimals(decimals);

        string memory symbol = IERC20Metadata(usdc_).symbol();
        if (keccak256(bytes(symbol)) != keccak256("USDC")) {
            revert InvalidUSDCSymbol(symbol);
        }

        USDC = IERC20(usdc_);
        EXPECTED_CHAIN_ID = expectedChainId_;
    }
}
```

### Forge Deployment Script

```solidity
// script/Deploy.s.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {USDCVault} from "../src/USDCVault.sol";

contract DeployScript is Script {
    function _getUSDCAddress() internal view returns (address) {
        if (block.chainid == 1) return 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
        if (block.chainid == 8453) return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        if (block.chainid == 42161) return 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
        if (block.chainid == 10) return 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85;
        if (block.chainid == 137) return 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
        if (block.chainid == 43114) return 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
        // Testnets
        if (block.chainid == 11155111) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        if (block.chainid == 84532) return 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
        if (block.chainid == 421614) return 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
        revert("Unsupported chain");
    }

    function run() external {
        vm.startBroadcast();
        new USDCVault(_getUSDCAddress());
        vm.stopBroadcast();
    }
}
```

## Common Pitfalls

| Pitfall | Consequence | Fix |
|---------|-------------|-----|
| Using `1e18` for USDC amounts | Over/underpaying by 10^12x | Always use `1e6` for USDC |
| Using bridged USDC (USDbC, USDC.e) | Missing permit, blocklist, CCTP support | Use native Circle-issued addresses only |
| Calling `transfer` directly | Reverts on non-standard tokens | Use `SafeERC20.safeTransfer` |
| Ignoring blocklist reverts | Stuck funds, failed liquidations | Allow withdrawal to alternative addresses |
| Hardcoding USDC address across chains | Wrong token on wrong chain | Use constructor param + chain ID validation |
| Not handling `pause` state | Critical operations (liquidations) fail | Implement emergency settlement paths |
| Precision loss in 6→18→6 round-trips | Protocol leaks or gains dust | Use `fromWadRoundUp` for debt, `fromWad` for credit |
| Assuming `permit` always succeeds | Front-run permit bricks the transaction | Wrap `permit` in try/catch, fall through to `transferFrom` |
| Not validating decimals at deploy time | Entire accounting is wrong | Check `decimals() == 6` in constructor |

## USDC Integration Checklist

### Pre-Development

- [ ] Confirmed using native (Circle-issued) USDC address for target chain
- [ ] Verified address onchain with `cast code` and `cast call "decimals()(uint8)"`
- [ ] Confirmed chain ID mapping is correct for all deployment targets

### Implementation

- [ ] All USDC amounts use 6-decimal math (`1e6` per dollar)
- [ ] `SafeERC20` used for every `transfer`, `transferFrom`, and `approve`
- [ ] Constructor validates `decimals() == 6` and `symbol() == "USDC"`
- [ ] Checks-effects-interactions pattern followed in all state-changing functions
- [ ] `nonReentrant` modifier on all functions that call USDC
- [ ] No hardcoded USDC address in contract body — passed via constructor `immutable`
- [ ] Decimal conversion uses explicit `SCALE_FACTOR` constant, not inline magic numbers
- [ ] Rounding direction is correct (round up for debt, round down for credit)

### Blocklist & Pause Handling

- [ ] Users can withdraw to an alternative recipient address (blocklist mitigation)
- [ ] Liquidation mechanism has a fallback (escrow) if USDC transfer reverts
- [ ] Protocol behavior during global USDC pause is documented
- [ ] Emergency withdrawal or settlement path exists that does not depend on USDC transfers

### Permit & Authorization

- [ ] `permit` calls are wrapped in try/catch to handle front-running
- [ ] `deadline` parameter is validated and not set excessively far in the future
- [ ] If using EIP-3009, prefer `receiveWithAuthorization` over `transferWithAuthorization`

### Testing

- [ ] Fork tests run against real mainnet USDC at the canonical address
- [ ] Blocklist scenario tested (blocklisted user attempts transfer)
- [ ] Pause scenario tested (transfers fail when USDC is paused)
- [ ] Permit flow tested with valid and invalid/expired signatures
- [ ] Decimal conversion tested at boundaries (0, 1, `type(uint256).max / SCALE_FACTOR`)
- [ ] Multichain addresses tested on respective forks

### Deployment

- [ ] Deployment script selects correct USDC address per chain ID
- [ ] Post-deploy verification checks `USDC` immutable matches expected address
- [ ] Integration test runs on testnet with faucet USDC before mainnet deploy

## Security Rules

1. **NEVER** use 18 decimals for USDC amounts.
2. **NEVER** use bridged USDC variants (USDbC, USDC.e) — always native.
3. **ALWAYS** verify the USDC address matches the deployment chain.
4. **ALWAYS** use `SafeERC20` for transfers — no direct `transfer` or `transferFrom` calls.
5. **ALWAYS** handle potential blocklist reverts with alternative withdrawal paths.
6. **ALWAYS** handle potential pause reverts in critical paths (liquidation, settlement).
7. **ALWAYS** validate `decimals() == 6` at deploy time.
8. **ALWAYS** wrap `permit` in try/catch to handle front-run signatures.
9. **NEVER** assume USDC has the same address on different chains.
10. **NEVER** hardcode USDC addresses in contract logic — use immutables set via constructor.

## References

- Circle Developer Docs: https://developers.circle.com/stablecoins/docs
- FiatTokenV2_2 Source: https://github.com/circlefin/stablecoin-evm
- CCTP (Cross-Chain Transfer Protocol): https://developers.circle.com/stablecoins/cctp-getting-started
- EIP-2612 (Permit): https://eips.ethereum.org/EIPS/eip-2612
- EIP-3009 (Transfer With Authorization): https://eips.ethereum.org/EIPS/eip-3009
- Testnet Faucet: https://faucet.circle.com
- OpenZeppelin SafeERC20: https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#SafeERC20
