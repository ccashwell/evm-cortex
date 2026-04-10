---
name: create2-patterns
description: Use when deploying contracts to deterministic addresses with CREATE2. Covers address prediction, salt selection, factory patterns, cross-chain same-address deployment, CREATE3, vanity addresses, and replay protection.
---

# CREATE2 Deterministic Deployment Patterns

## Address Calculation

CREATE2 address is determined by four inputs:

```
address = keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]
```

```solidity
function computeAddress(bytes32 salt, bytes32 initCodeHash, address deployer)
    internal pure returns (address)
{
    return address(uint160(uint256(keccak256(abi.encodePacked(
        bytes1(0xff), deployer, salt, initCodeHash
    )))));
}
```

## Basic CREATE2 Factory

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Create2Factory {
    event Deployed(address indexed addr, bytes32 indexed salt);

    function deploy(bytes32 salt, bytes memory creationCode)
        external payable returns (address deployed)
    {
        assembly {
            deployed := create2(callvalue(), add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(deployed != address(0), "CREATE2: deployment failed");
        emit Deployed(deployed, salt);
    }

    function computeAddress(bytes32 salt, bytes memory creationCode)
        external view returns (address)
    {
        bytes32 hash = keccak256(abi.encodePacked(
            bytes1(0xff), address(this), salt, keccak256(creationCode)
        ));
        return address(uint160(uint256(hash)));
    }
}
```

## Salt Selection Strategies

```solidity
// Simple: use deployer address + nonce
bytes32 salt = keccak256(abi.encode(msg.sender, nonce));

// Access-controlled: only specific deployer can use this salt
bytes32 salt = keccak256(abi.encode(msg.sender, "MyContract-v1"));

// Include constructor args in salt for uniqueness
bytes32 salt = keccak256(abi.encode(msg.sender, name, symbol, initialSupply));
```

## Cross-Chain Same-Address Deployment

To deploy at the same address on multiple chains:

1. Use the same factory contract address on all chains (deploy factory with CREATE2 from an EOA at same nonce, or use a known factory like Arachnid's)
2. Use the same salt
3. Use the same creation code (including constructor arguments)

```solidity
// Arachnid's deterministic deployment proxy (deployed on most chains):
// 0x4e59b44847b379578588920cA78FbF26c0B4956C

// Deploy to same address on any chain:
bytes memory initCode = abi.encodePacked(type(MyContract).creationCode, abi.encode(arg1, arg2));
bytes32 salt = keccak256("my-protocol-v1");

// Submit identical tx to factory on each chain
```

## CREATE3 Pattern (Address Independent of Init Code)

CREATE3 makes the deployed address independent of constructor arguments. Useful when constructor args differ per chain but you want the same address:

```solidity
library CREATE3 {
    bytes internal constant PROXY_BYTECODE = hex"67363d3d37363d34f03d5260086018f3";
    bytes32 internal constant PROXY_BYTECODE_HASH = keccak256(PROXY_BYTECODE);

    function deploy(bytes32 salt, bytes memory creationCode, uint256 value)
        internal returns (address deployed)
    {
        // Step 1: deploy a minimal proxy via CREATE2 (deterministic)
        address proxy;
        assembly {
            proxy := create2(0, add(PROXY_BYTECODE, 0x20), mload(PROXY_BYTECODE), salt)
        }
        require(proxy != address(0), "CREATE3: proxy deploy failed");

        // Step 2: proxy deploys the real contract via CREATE (nonce-based)
        // The real contract address = f(proxy address, nonce=1)
        (bool ok,) = proxy.call{value: value}(creationCode);
        require(ok, "CREATE3: deploy failed");

        deployed = addressOf(salt);
    }

    function addressOf(bytes32 salt) internal view returns (address) {
        address proxy = address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), address(this), salt, PROXY_BYTECODE_HASH
        )))));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes2(0xd694), proxy, bytes1(0x01)
        )))));
    }
}
```

## Replay Protection

Prevent the same contract from being deployed twice to the same address:

```solidity
contract SafeCreate2Factory {
    mapping(address => bool) public isDeployed;

    function deploy(bytes32 salt, bytes memory creationCode)
        external payable returns (address deployed)
    {
        deployed = _computeAddress(salt, creationCode);
        require(!isDeployed[deployed], "Already deployed");

        assembly {
            deployed := create2(callvalue(), add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(deployed != address(0), "Deploy failed");
        isDeployed[deployed] = true;
    }
}
```

## Vanity Addresses

Mine salts for addresses with desirable prefixes:

```solidity
// Off-chain salt mining (pseudocode)
// for salt in 0..2^256:
//     addr = computeCreate2Address(factory, salt, initCodeHash)
//     if addr starts with 0x0000:
//         return salt

// Use create2crunch or similar GPU miner for efficient vanity search
```

```bash
# create2crunch: GPU-accelerated vanity address mining
create2crunch --factory 0xFactory... --caller 0xCaller... \
  --init-code-hash 0xHash... --leading 4 --total 6
```

## Foundry Testing

```solidity
function test_create2_deterministic() public {
    bytes32 salt = keccak256("test-salt");
    bytes memory initCode = abi.encodePacked(
        type(MyContract).creationCode,
        abi.encode("arg1", 42)
    );

    address predicted = factory.computeAddress(salt, initCode);
    address deployed = factory.deploy(salt, initCode);

    assertEq(deployed, predicted, "Address mismatch");
    assertGt(deployed.code.length, 0, "No code at address");
}

function test_create2_sameAddressDifferentChains() public {
    bytes32 salt = keccak256("cross-chain");
    bytes memory initCode = type(MyContract).creationCode;

    // Same factory + salt + initCode = same address regardless of chain
    address addr = factory.computeAddress(salt, initCode);
    assertTrue(addr != address(0));
}
```

## Key Considerations

- CREATE2 address depends on init code, so different constructor args = different address
- CREATE3 removes init code dependency (address depends only on factory + salt)
- If a contract is `selfdestruct`ed, a new contract CAN be deployed at the same CREATE2 address
- `selfdestruct` is deprecated post-Dencun (EIP-6780) — only works in same tx as creation
- Always verify the deployed bytecode matches expectations after cross-chain deployment
