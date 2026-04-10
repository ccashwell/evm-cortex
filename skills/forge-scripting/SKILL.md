---
name: forge-scripting
description: Use when writing Forge deployment and interaction scripts. Covers broadcast transactions, multi-chain deployment, verification, dry-run vs broadcast, cheatcodes, and environment variable usage.
---

# Forge Script Deployment Patterns

## Basic Deployment Script

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MyToken} from "../src/MyToken.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console2.log("Deployer:", deployer);
        console2.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerKey);

        MyToken token = new MyToken("My Token", "MTK", 1_000_000e18);
        console2.log("Token deployed at:", address(token));

        vm.stopBroadcast();
    }
}
```

## Running Scripts

```bash
# Dry run (simulation only, no tx sent)
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL

# Broadcast (send real transactions)
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL --broadcast

# Broadcast + verify on Etherscan
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL \
  --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY

# With specific sender
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL \
  --broadcast --sender 0xDeployer

# Resume failed broadcast
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL --resume

# Slow mode (wait for each tx confirmation)
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL --broadcast --slow
```

## Deployment Script Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MyProtocol} from "../src/MyProtocol.sol";
import {Treasury} from "../src/Treasury.sol";

contract DeployProtocol is Script {
    struct DeployConfig {
        address admin;
        address treasury;
        uint256 feeRate;
        address weth;
    }

    function getConfig() internal view returns (DeployConfig memory) {
        if (block.chainid == 1) {
            return DeployConfig({
                admin: vm.envAddress("MAINNET_ADMIN"),
                treasury: vm.envAddress("MAINNET_TREASURY"),
                feeRate: 30, // 0.3%
                weth: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
            });
        } else if (block.chainid == 8453) {
            return DeployConfig({
                admin: vm.envAddress("BASE_ADMIN"),
                treasury: vm.envAddress("BASE_TREASURY"),
                feeRate: 30,
                weth: 0x4200000000000000000000000000000000000006
            });
        } else if (block.chainid == 11155111) {
            return DeployConfig({
                admin: msg.sender,
                treasury: msg.sender,
                feeRate: 100,
                weth: address(0)
            });
        } else {
            revert("Unsupported chain");
        }
    }

    function run() external {
        DeployConfig memory cfg = getConfig();
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        // Deploy implementation
        MyProtocol impl = new MyProtocol();
        console2.log("Implementation:", address(impl));

        // Deploy proxy
        bytes memory initData = abi.encodeCall(
            MyProtocol.initialize, (cfg.admin, cfg.treasury, cfg.feeRate, cfg.weth)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        console2.log("Proxy:", address(proxy));

        // Deploy treasury
        Treasury treasury = new Treasury(address(proxy));
        console2.log("Treasury:", address(treasury));

        // Post-deploy configuration
        MyProtocol(address(proxy)).setTreasury(address(treasury));

        vm.stopBroadcast();

        // Verify deployment (runs after broadcast)
        _verify(address(proxy), cfg);
    }

    function _verify(address proxy, DeployConfig memory cfg) internal view {
        MyProtocol protocol = MyProtocol(proxy);
        require(protocol.admin() == cfg.admin, "Admin mismatch");
        require(protocol.feeRate() == cfg.feeRate, "Fee mismatch");
        console2.log("Verification passed");
    }
}
```

## Multi-Chain Deployment

```solidity
contract MultiChainDeploy is Script {
    function deployToChain(string memory rpcAlias) internal {
        vm.createSelectFork(rpcAlias);
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        MyContract c = new MyContract();
        console2.log("Chain", block.chainid, "deployed at:", address(c));
        vm.stopBroadcast();
    }

    function run() external {
        deployToChain("mainnet");
        deployToChain("base");
        deployToChain("optimism");
    }
}
```

```bash
# Deploy to multiple chains
forge script script/MultiChainDeploy.s.sol --broadcast \
  --multi --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

## Cheatcodes in Scripts

```solidity
// Environment variables
uint256 key = vm.envUint("PRIVATE_KEY");
address addr = vm.envAddress("ADMIN_ADDRESS");
string memory rpc = vm.envString("RPC_URL");
bool isProd = vm.envBool("IS_PRODUCTION");
uint256 optionalVal = vm.envOr("OPTIONAL_VAL", uint256(42));

// Broadcasting
vm.startBroadcast(key);     // All subsequent calls are real txs
vm.stopBroadcast();

vm.broadcast(key);           // Only next call is a real tx

// File I/O
string memory json = vm.readFile("config.json");
vm.writeFile("output.json", data);

// JSON parsing
bytes memory raw = vm.parseJson(json, ".deploy.address");
address deployed = abi.decode(raw, (address));

// Compute CREATE2 address
address predicted = vm.computeCreate2Address(
    salt, keccak256(type(MyContract).creationCode), factory
);
```

## Broadcast Artifacts

After `--broadcast`, Foundry saves transaction data to:

```
broadcast/
└── Deploy.s.sol/
    ├── 1/            # Chain ID
    │   ├── run-latest.json    # Latest broadcast
    │   └── run-1234567.json   # Timestamped
    └── 8453/
        └── run-latest.json
```

Each file contains:
- Transaction hashes
- Contract addresses
- Gas used
- Constructor arguments

## Verification in Scripts

```bash
# Auto-verify during broadcast
forge script script/Deploy.s.sol --broadcast --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Verify after deployment
forge verify-contract 0xContractAddress MyContract \
  --chain-id 1 --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" 0xAdmin 100)
```

## Script Best Practices

1. **Always dry-run first**: Run without `--broadcast` to simulate
2. **Pin dependencies**: Use exact compiler and dependency versions
3. **Chain-specific config**: Use `block.chainid` for per-chain settings
4. **Post-deploy verification**: Assert critical state after deployment
5. **Idempotent scripts**: Check if contracts exist before deploying
6. **Save addresses**: Write deployed addresses to a registry file
7. **Use `--slow` for mainnet**: Wait for confirmations on high-value deploys

```solidity
// Idempotent deploy pattern
function run() external {
    address existing = vm.envOr("EXISTING_CONTRACT", address(0));
    if (existing != address(0) && existing.code.length > 0) {
        console2.log("Already deployed at:", existing);
        return;
    }
    // ... deploy
}
```

## Gas Estimation

```bash
# Estimate gas without broadcasting
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL -vvvv

# The -vvvv output shows gas used per transaction
```
