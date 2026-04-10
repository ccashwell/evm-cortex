---
name: multichain-deployment
description: Use when deploying the same protocol to multiple chains at the same address. Covers CREATE2 for deterministic addresses, deployment registries, chain-specific configuration, multi-chain testing, and canonical deployment patterns.
---

# Multi-Chain Deployment Patterns

## Strategy Overview

For protocol credibility and UX, deploy contracts at the **same address** on every chain. This requires deterministic deployment via CREATE2 and a consistent deployment flow.

## Deterministic Deployment Factory

Use a pre-deployed CREATE2 factory that exists at the same address on all EVM chains.

**Arachnid's Deterministic Deployment Proxy** (available on nearly all chains):
```
0x4e59b44847b379578588920cA78FbF26c0B4956C
```

```solidity
// Deploy via the keyless CREATE2 factory
function deployDeterministic(bytes memory creationCode, bytes32 salt)
    external returns (address deployed)
{
    address factory = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes memory payload = abi.encodePacked(salt, creationCode);
    (bool ok, bytes memory result) = factory.call(payload);
    require(ok, "Deploy failed");
    deployed = address(uint160(uint256(keccak256(abi.encodePacked(
        bytes1(0xff), factory, salt, keccak256(creationCode)
    )))));
}
```

## Multi-Chain Forge Script

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MyProtocol} from "../src/MyProtocol.sol";

contract MultiChainDeploy is Script {
    address constant CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 constant SALT = keccak256("myprotocol-v1.0.0");

    struct ChainConfig {
        string rpc;
        uint256 chainId;
        address admin;
        address weth;
    }

    function configs() internal view returns (ChainConfig[] memory) {
        ChainConfig[] memory c = new ChainConfig[](4);
        address admin = vm.envAddress("ADMIN_ADDRESS");

        c[0] = ChainConfig("mainnet", 1, admin, 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
        c[1] = ChainConfig("base", 8453, admin, 0x4200000000000000000000000000000000000006);
        c[2] = ChainConfig("optimism", 10, admin, 0x4200000000000000000000000000000000000006);
        c[3] = ChainConfig("arbitrum", 42161, admin, 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1);
        return c;
    }

    function predictAddress() public view returns (address) {
        bytes memory initCode = type(MyProtocol).creationCode;
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), CREATE2_FACTORY, SALT, keccak256(initCode)
        )))));
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        ChainConfig[] memory chains = configs();
        address predicted = predictAddress();

        console2.log("Predicted address:", predicted);

        for (uint256 i = 0; i < chains.length; i++) {
            console2.log("\n--- Deploying to", chains[i].rpc, "---");
            vm.createSelectFork(chains[i].rpc);

            if (predicted.code.length > 0) {
                console2.log("  Already deployed, skipping");
                continue;
            }

            vm.startBroadcast(deployerKey);

            bytes memory initCode = type(MyProtocol).creationCode;
            bytes memory payload = abi.encodePacked(SALT, initCode);
            (bool ok,) = CREATE2_FACTORY.call(payload);
            require(ok, "Deploy failed");
            require(predicted.code.length > 0, "Code not at predicted address");

            console2.log("  Deployed at:", predicted);

            // Chain-specific initialization
            MyProtocol(predicted).initialize(chains[i].admin, chains[i].weth);

            vm.stopBroadcast();
        }
    }
}
```

```bash
forge script script/MultiChainDeploy.s.sol --broadcast --multi --verify
```

## Deployment Registry

Track deployments across chains:

```json
{
  "protocol": "MyProtocol",
  "version": "1.0.0",
  "salt": "0x...",
  "deployments": {
    "1": {
      "address": "0xSameOnAllChains",
      "txHash": "0x...",
      "blockNumber": 18000000,
      "deployer": "0x...",
      "timestamp": "2025-06-01T00:00:00Z"
    },
    "8453": {
      "address": "0xSameOnAllChains",
      "txHash": "0x...",
      "blockNumber": 5000000,
      "deployer": "0x...",
      "timestamp": "2025-06-01T00:05:00Z"
    }
  }
}
```

Generate automatically in your deploy script:

```solidity
function _writeDeployment(uint256 chainId, address deployed, bytes32 txHash) internal {
    string memory key = vm.toString(chainId);
    string memory json = vm.serializeAddress(key, "address", deployed);
    json = vm.serializeBytes32(key, "txHash", txHash);
    json = vm.serializeUint(key, "blockNumber", block.number);
    vm.writeJson(json, "./deployments.json", string.concat(".", key));
}
```

## Chain-Specific Configuration

When contracts need different config per chain but the same address:

```solidity
contract MyProtocol {
    address public admin;
    address public weth;
    bool private _initialized;

    function initialize(address admin_, address weth_) external {
        require(!_initialized, "Already initialized");
        _initialized = true;
        admin = admin_;
        weth = weth_;
    }
}
```

For CREATE3 (address independent of constructor args):

```solidity
import {CREATE3} from "solady/utils/CREATE3.sol";

contract MultiChainFactory {
    function deploy(bytes32 salt, bytes memory creationCode) external returns (address) {
        return CREATE3.deploy(salt, creationCode, 0);
    }

    function predict(bytes32 salt) external view returns (address) {
        return CREATE3.getDeployed(salt);
    }
}
```

## Multi-Chain Testing

```solidity
contract MultiChainTest is Test {
    uint256 mainnetFork;
    uint256 baseFork;
    uint256 opFork;

    function setUp() public {
        mainnetFork = vm.createFork("mainnet");
        baseFork = vm.createFork("base");
        opFork = vm.createFork("optimism");
    }

    function test_deploysSameAddress() public {
        bytes32 salt = keccak256("test-v1");
        bytes memory initCode = type(MyProtocol).creationCode;

        vm.selectFork(mainnetFork);
        address addrMainnet = _deployViaCreate2(salt, initCode);

        vm.selectFork(baseFork);
        address addrBase = _deployViaCreate2(salt, initCode);

        vm.selectFork(opFork);
        address addrOp = _deployViaCreate2(salt, initCode);

        assertEq(addrMainnet, addrBase, "Mainnet != Base");
        assertEq(addrBase, addrOp, "Base != Optimism");
    }
}
```

## Verification Across Chains

```bash
#!/bin/bash
# verify-all.sh

CHAINS=("mainnet" "base" "optimism" "arbitrum")
CONTRACT_ADDR="0xSameOnAllChains"
CONTRACT_PATH="src/MyProtocol.sol:MyProtocol"

for chain in "${CHAINS[@]}"; do
  echo "Verifying on $chain..."
  forge verify-contract "$CONTRACT_ADDR" "$CONTRACT_PATH" \
    --chain "$chain" --watch
done
```

## Multi-Chain Deployment Checklist

- [ ] Same CREATE2 factory exists on all target chains
- [ ] Salt is unique per protocol version
- [ ] Init code is identical (same compiler, settings, no chain-specific constructor args)
- [ ] Predicted address verified before deployment
- [ ] Idempotent script (skips chains already deployed)
- [ ] Chain-specific config applied via `initialize` (not constructor)
- [ ] Deployment registry updated after each chain
- [ ] Contracts verified on each chain's block explorer
- [ ] Cross-chain functionality tested (bridges, messaging)
- [ ] Admin/governance addresses correct per chain
