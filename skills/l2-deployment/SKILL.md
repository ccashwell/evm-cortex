---
name: l2-deployment
description: Use when deploying contracts to L2 networks (Base, Optimism, Arbitrum). Covers L2-specific considerations, PUSH0 compatibility, gas estimation, L1 data costs, bridge integration, and deployment scripts.
---

# L2 Deployment Patterns

## L2 Gas Economics

L2 transaction cost = L2 execution gas + L1 data posting cost

| Operation | L1 (Ethereum) | L2 (Base/OP/Arb) | Savings |
|-----------|:------------:|:----------------:|:-------:|
| ETH transfer | ~$0.50 | ~$0.0003 | 99.9% |
| ERC-20 transfer | ~$2.00 | ~$0.001 | 99.9% |
| Uniswap swap | ~$8.00 | ~$0.002-0.003 | 99.9% |
| NFT mint | ~$5.00 | ~$0.002 | 99.9% |
| Contract deploy | ~$50-500 | ~$0.05-0.50 | 99% |

Post-EIP-4844 (blobs), L1 data costs dropped 10-100x for L2s.

## L2-Specific Considerations

### PUSH0 Opcode Compatibility

PUSH0 was introduced in the Shanghai upgrade (EVM version). Some L2s may lag behind on EVM version support:

```toml
# foundry.toml — set EVM version explicitly for L2
[profile.default]
evm_version = "cancun"     # Base, Optimism, Arbitrum all support cancun

# If targeting an L2 that doesn't support cancun:
# evm_version = "paris"    # No PUSH0
```

### Block Time Differences

| Chain | Block Time | Implication |
|-------|-----------|-------------|
| Ethereum | ~12s | Standard |
| Base | 2s | Faster confirmations |
| Optimism | 2s | Faster confirmations |
| Arbitrum | ~0.25s | Near-instant |

Avoid hardcoding time assumptions based on block numbers.

### L2-Specific Addresses

```solidity
// Optimism / Base predeploys (same addresses on all OP Stack chains)
address constant L2_CROSS_DOMAIN_MESSENGER = 0x4200000000000000000000000000000000000007;
address constant L2_STANDARD_BRIDGE = 0x4200000000000000000000000000000000000010;
address constant L2_TO_L1_MESSAGE_PASSER = 0x4200000000000000000000000000000000000016;
address constant WETH = 0x4200000000000000000000000000000000000006;
address constant L1_BLOCK = 0x4200000000000000000000000000000000000015;
address constant GAS_PRICE_ORACLE = 0x420000000000000000000000000000000000000F;

// Arbitrum system addresses
address constant ARB_SYS = 0x0000000000000000000000000000000000000064;
address constant ARB_RETRYABLE_TX = 0x000000000000000000000000000000000000006E;
```

## Foundry Multi-L2 Deployment Script

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MyProtocol} from "../src/MyProtocol.sol";

contract DeployL2 is Script {
    struct L2Config {
        string rpcAlias;
        uint256 chainId;
        address weth;
        address usdc;
    }

    function getConfigs() internal pure returns (L2Config[] memory) {
        L2Config[] memory configs = new L2Config[](3);

        configs[0] = L2Config({
            rpcAlias: "base",
            chainId: 8453,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
        });

        configs[1] = L2Config({
            rpcAlias: "optimism",
            chainId: 10,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85
        });

        configs[2] = L2Config({
            rpcAlias: "arbitrum",
            chainId: 42161,
            weth: 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1,
            usdc: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
        });

        return configs;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        L2Config[] memory configs = getConfigs();

        for (uint256 i = 0; i < configs.length; i++) {
            L2Config memory cfg = configs[i];
            console2.log("Deploying to chain:", cfg.chainId);

            vm.createSelectFork(cfg.rpcAlias);
            vm.startBroadcast(deployerKey);

            MyProtocol protocol = new MyProtocol(cfg.weth, cfg.usdc);
            console2.log("  Deployed at:", address(protocol));

            vm.stopBroadcast();
        }
    }
}
```

```bash
# Deploy to all L2s
forge script script/DeployL2.s.sol --broadcast --multi --verify
```

## L1 Data Cost Estimation

On OP Stack chains (Base, Optimism), query the gas price oracle:

```solidity
interface IGasPriceOracle {
    function getL1Fee(bytes memory data) external view returns (uint256);
    function getL1GasUsed(bytes memory data) external view returns (uint256);
}

IGasPriceOracle oracle = IGasPriceOracle(0x420000000000000000000000000000000000000F);
uint256 l1Fee = oracle.getL1Fee(txData);
```

On Arbitrum, L1 data costs are embedded in the gas price.

## Bridge Integration

### OP Stack Bridge (Base / Optimism)

```solidity
interface IL2StandardBridge {
    function bridgeETHTo(address to, uint32 minGasLimit, bytes calldata extraData) external payable;
    function bridgeERC20To(
        address localToken, address remoteToken,
        address to, uint256 amount, uint32 minGasLimit, bytes calldata extraData
    ) external;
}

// Bridge ETH from L2 to L1
IL2StandardBridge(0x4200000000000000000000000000000000000010).bridgeETHTo{value: amount}(
    recipient, 200_000, ""
);
```

### Arbitrum Bridge

```solidity
interface IArbSys {
    function withdrawEth(address destination) external payable returns (uint256);
    function sendTxToL1(address destination, bytes calldata data) external payable returns (uint256);
}

// Withdraw ETH from Arbitrum to L1
IArbSys(0x0000000000000000000000000000000000000064).withdrawEth{value: amount}(recipient);
```

## Testing on Forked L2s

```solidity
function setUp() public {
    vm.createSelectFork("base", 20_000_000);
}

function test_swapOnBase() public {
    address whale = 0x...; // Known USDC holder on Base
    vm.startPrank(whale);
    // Interact with real Base contracts
    vm.stopPrank();
}
```

## L2 Deployment Checklist

- [ ] Set correct `evm_version` in `foundry.toml` for target L2
- [ ] Use L2-specific WETH and token addresses (not mainnet addresses)
- [ ] Account for different block times in time-based logic
- [ ] Test on forked L2 before deploying
- [ ] Estimate L1 data costs for gas-sensitive operations
- [ ] Verify contracts on the correct L2 block explorer
- [ ] Configure bridge integration if cross-chain messaging needed
- [ ] Test with L2-specific gas prices (much lower than L1)
- [ ] Check L2 predeploy addresses for system contracts
- [ ] Deploy to testnet first (Base Sepolia, OP Sepolia, Arbitrum Sepolia)
