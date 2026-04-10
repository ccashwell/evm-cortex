---
name: diamond-pattern
description: Use when building large modular contracts with EIP-2535 Diamond pattern. Covers facets, diamondCut, diamond loupe, AppStorage and DiamondStorage patterns, selector mapping, and facet upgrade process.
---

# EIP-2535 Diamond Pattern

## Overview

The Diamond pattern splits a contract into multiple "facets" (logic modules) that share a single storage and address. Bypasses the 24KB contract size limit and enables surgical upgrades of individual functions.

## Architecture

```
User → Diamond Proxy
         ├── FacetA (functions a1, a2)
         ├── FacetB (functions b1, b2, b3)
         ├── DiamondCutFacet (add/replace/remove functions)
         └── DiamondLoupeFacet (introspection)
```

All facets share the Diamond's storage context via `delegatecall`.

## Diamond Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibDiamond} from "./libraries/LibDiamond.sol";

contract Diamond {
    constructor(address contractOwner, address diamondCutFacet) payable {
        LibDiamond.setContractOwner(contractOwner);
        LibDiamond.FacetCut[] memory cut = new LibDiamond.FacetCut[](1);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IDiamondCut.diamondCut.selector;
        cut[0] = LibDiamond.FacetCut({
            facetAddress: diamondCutFacet,
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });
        LibDiamond.diamondCut(cut, address(0), "");
    }

    fallback() external payable {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}
```

## DiamondCut Interface

```solidity
interface IDiamondCut {
    enum FacetCutAction { Add, Replace, Remove }

    struct FacetCut {
        address facetAddress;
        FacetCutAction action;
        bytes4[] functionSelectors;
    }

    event DiamondCut(FacetCut[] diamondCut, address init, bytes calldata);

    function diamondCut(
        FacetCut[] calldata diamondCut_,
        address init_,
        bytes calldata calldata_
    ) external;
}
```

## Storage Patterns

### AppStorage (Recommended for Single Diamond)

All state in one struct at a fixed position:

```solidity
struct AppStorage {
    // Token state
    mapping(address => uint256) balances;
    mapping(address => mapping(address => uint256)) allowances;
    uint256 totalSupply;
    string name;
    string symbol;

    // Protocol state
    address treasury;
    uint256 feeRate;
    mapping(address => bool) operators;
}

library LibAppStorage {
    bytes32 constant APP_STORAGE_POSITION = keccak256("myprotocol.app.storage");

    function appStorage() internal pure returns (AppStorage storage s) {
        bytes32 position = APP_STORAGE_POSITION;
        assembly { s.slot := position }
    }
}

// Usage in any facet:
contract TokenFacet {
    function balanceOf(address account) external view returns (uint256) {
        return LibAppStorage.appStorage().balances[account];
    }
}
```

### DiamondStorage (Per-Facet Namespaced Storage)

Each facet gets its own storage namespace. Better for composable/reusable facets:

```solidity
library LibTokenStorage {
    bytes32 constant STORAGE_POSITION = keccak256("myprotocol.token.storage");

    struct TokenStorage {
        mapping(address => uint256) balances;
        uint256 totalSupply;
    }

    function tokenStorage() internal pure returns (TokenStorage storage s) {
        bytes32 position = STORAGE_POSITION;
        assembly { s.slot := position }
    }
}

library LibGovernanceStorage {
    bytes32 constant STORAGE_POSITION = keccak256("myprotocol.governance.storage");

    struct GovernanceStorage {
        mapping(uint256 => Proposal) proposals;
        uint256 proposalCount;
    }

    function governanceStorage() internal pure returns (GovernanceStorage storage s) {
        bytes32 position = STORAGE_POSITION;
        assembly { s.slot := position }
    }
}
```

## Example Facet

```solidity
contract ERC20Facet {
    using LibAppStorage for *;

    event Transfer(address indexed from, address indexed to, uint256 value);

    function transfer(address to, uint256 amount) external returns (bool) {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.balances[msg.sender] >= amount, "Insufficient balance");

        s.balances[msg.sender] -= amount;
        s.balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function balanceOf(address account) external view returns (uint256) {
        return LibAppStorage.appStorage().balances[account];
    }
}
```

## Diamond Loupe (Introspection)

```solidity
interface IDiamondLoupe {
    struct Facet {
        address facetAddress;
        bytes4[] functionSelectors;
    }

    function facets() external view returns (Facet[] memory);
    function facetFunctionSelectors(address facet) external view returns (bytes4[] memory);
    function facetAddresses() external view returns (address[] memory);
    function facetAddress(bytes4 selector) external view returns (address);
}
```

## Upgrade Process

```solidity
// Add new functions
IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](1);
bytes4[] memory selectors = new bytes4[](2);
selectors[0] = NewFacet.newFunction1.selector;
selectors[1] = NewFacet.newFunction2.selector;
cuts[0] = IDiamondCut.FacetCut({
    facetAddress: address(newFacet),
    action: IDiamondCut.FacetCutAction.Add,
    functionSelectors: selectors
});

// With initialization callback
diamond.diamondCut(cuts, address(initContract), abi.encodeCall(DiamondInit.init, ()));

// Replace existing functions
cuts[0].action = IDiamondCut.FacetCutAction.Replace;

// Remove functions (set facetAddress to address(0))
cuts[0].facetAddress = address(0);
cuts[0].action = IDiamondCut.FacetCutAction.Remove;
```

## Diamond vs Other Patterns

| Aspect | UUPS | Diamond |
|--------|------|---------|
| Max contract size | 24KB | Unlimited (split across facets) |
| Upgrade granularity | Whole implementation | Per-function |
| Shared storage | N/A | All facets share |
| Complexity | Low | High |
| Audit cost | Lower | Higher |
| Introspection | No | DiamondLoupe |

## When to Use Diamond

- Contract exceeds 24KB limit
- Protocol needs modular upgrades (change one function without redeploying all)
- Multiple teams work on different facets independently
- Need EIP-165 introspection of all supported interfaces

## Security Checklist

- [ ] Only owner/governance can call `diamondCut`
- [ ] Storage layout is consistent across all facets (use AppStorage or DiamondStorage)
- [ ] No storage collisions between facets (test with `forge inspect`)
- [ ] Selector clashes are detected before `diamondCut` (no two facets share a selector)
- [ ] DiamondLoupe is implemented for transparency
- [ ] Initialization contract runs exactly once during upgrades
- [ ] Test full upgrade cycle: add facet → verify → replace → verify → remove
