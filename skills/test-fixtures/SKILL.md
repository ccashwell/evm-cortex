---
name: test-fixtures
description: Use when setting up test environments for Solidity protocols. Covers mock contracts, fork-based fixtures, shared setUp, factory patterns, token deployments, and reusable test helpers.
---

# Test Fixtures & Helpers

## Base Test Contract

Shared setUp that all test files inherit:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract BaseTest is Test {
    address public alice;
    address public bob;
    address public carol;
    address public deployer;
    address public treasury;

    function setUp() public virtual {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        deployer = makeAddr("deployer");
        treasury = makeAddr("treasury");

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _labelAll() internal {
        vm.label(alice, "Alice");
        vm.label(bob, "Bob");
        vm.label(carol, "Carol");
        vm.label(deployer, "Deployer");
        vm.label(treasury, "Treasury");
    }

    function _fundToken(address token, address to, uint256 amount) internal {
        deal(token, to, amount);
    }

    function _approveToken(address token, address owner, address spender, uint256 amount) internal {
        vm.prank(owner);
        IERC20(token).approve(spender, amount);
    }
}
```

## Mock ERC20 Token

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_)
        ERC20(name, symbol)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
```

## Token Fixture Library

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "./MockERC20.sol";

library TokenFixtures {
    function deployUSDC() internal returns (MockERC20) {
        return new MockERC20("USD Coin", "USDC", 6);
    }

    function deployWETH() internal returns (MockERC20) {
        return new MockERC20("Wrapped Ether", "WETH", 18);
    }

    function deployDAI() internal returns (MockERC20) {
        return new MockERC20("Dai Stablecoin", "DAI", 18);
    }

    function deployWithDecimals(uint8 decimals) internal returns (MockERC20) {
        return new MockERC20("Test Token", "TEST", decimals);
    }
}
```

## Mock Oracle

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockChainlinkFeed {
    int256 private _price;
    uint8 private _decimals;
    uint256 private _updatedAt;
    uint80 private _roundId;

    constructor(int256 price, uint8 decimals_) {
        _price = price;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
        _roundId = 1;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function setPrice(int256 newPrice) external {
        _price = newPrice;
        _updatedAt = block.timestamp;
        _roundId++;
    }

    function setStale() external {
        _updatedAt = block.timestamp - 2 days;
    }
}
```

## Protocol Deployment Fixture

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseTest} from "./BaseTest.sol";
import {Vault} from "../../src/Vault.sol";
import {StakingRewards} from "../../src/StakingRewards.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockChainlinkFeed} from "./MockChainlinkFeed.sol";

abstract contract ProtocolFixture is BaseTest {
    MockERC20 public usdc;
    MockERC20 public weth;
    MockChainlinkFeed public ethUsdFeed;
    Vault public vault;
    StakingRewards public staking;

    function setUp() public virtual override {
        super.setUp();

        vm.startPrank(deployer);

        usdc = new MockERC20("USDC", "USDC", 6);
        weth = new MockERC20("WETH", "WETH", 18);
        ethUsdFeed = new MockChainlinkFeed(3500e8, 8);

        vault = new Vault(address(usdc));
        staking = new StakingRewards(
            address(vault),
            address(usdc),
            deployer
        );

        vm.stopPrank();

        _fundUsers();
        _labelAll();
        vm.label(address(usdc), "USDC");
        vm.label(address(weth), "WETH");
        vm.label(address(vault), "Vault");
        vm.label(address(staking), "Staking");
    }

    function _fundUsers() internal {
        for (uint256 i = 0; i < _users().length; i++) {
            address user = _users()[i];
            usdc.mint(user, 1_000_000e6);
            weth.mint(user, 1_000e18);

            vm.startPrank(user);
            usdc.approve(address(vault), type(uint256).max);
            usdc.approve(address(staking), type(uint256).max);
            weth.approve(address(vault), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _users() internal view returns (address[] memory) {
        address[] memory users = new address[](3);
        users[0] = alice;
        users[1] = bob;
        users[2] = carol;
        return users;
    }
}
```

## Usage in Tests

```solidity
import {ProtocolFixture} from "./helpers/ProtocolFixture.sol";

contract VaultTest is ProtocolFixture {
    function test_deposit() public {
        vm.prank(alice);
        vault.deposit(1000e6, alice);
        assertEq(vault.balanceOf(alice), 1000e6);
    }

    function test_priceDropLiquidation() public {
        vm.prank(alice);
        vault.deposit(1000e6, alice);

        ethUsdFeed.setPrice(1000e8); // crash ETH price
        assertTrue(vault.isLiquidatable(alice));
    }
}
```

## Fork-Based Fixtures

```solidity
abstract contract MainnetFixture is BaseTest {
    IERC20 constant USDC = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    IERC20 constant WETH = IERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    IPool constant AAVE = IPool(0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2);

    function setUp() public virtual override {
        super.setUp();
        vm.createSelectFork("mainnet", 19_500_000);
        _labelMainnet();
    }

    function _labelMainnet() internal {
        vm.label(address(USDC), "USDC");
        vm.label(address(WETH), "WETH");
        vm.label(address(AAVE), "Aave Pool");
    }
}
```

## Checklist

- [ ] Base test contract provides common users, funding, and labels
- [ ] Mock tokens support configurable decimals
- [ ] Mock oracles support price manipulation and staleness simulation
- [ ] Protocol fixture deploys complete system in correct order
- [ ] All users pre-funded and pre-approved in setUp
- [ ] All contract addresses labeled for readable traces
- [ ] Fork fixtures pinned to specific blocks
- [ ] Fixtures are `abstract` — tests inherit and extend
- [ ] Separate mock directory: `test/mocks/`
- [ ] Shared helpers in `test/helpers/`
