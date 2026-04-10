---
name: foundry-setup
description: Use when setting up a Foundry project from scratch or configuring foundry.toml. Covers forge init, solc configuration, optimizer settings, via-ir, remappings, directory structure, and dependency management.
---

# Foundry Project Setup

## Quick Start

```bash
# New project
forge init my-protocol
cd my-protocol

# Or init in existing directory
forge init --force .

# Install dependencies
forge install OpenZeppelin/openzeppelin-contracts
forge install OpenZeppelin/openzeppelin-contracts-upgradeable
forge install foundry-rs/forge-std
```

## Directory Structure

```
my-protocol/
├── foundry.toml          # Project configuration
├── remappings.txt        # Import remappings (auto-generated)
├── src/                  # Contract source files
│   ├── MyContract.sol
│   └── interfaces/
├── test/                 # Test files
│   ├── MyContract.t.sol
│   ├── invariants/       # Invariant/fuzz tests
│   └── mocks/
├── script/               # Deployment scripts
│   ├── Deploy.s.sol
│   └── Upgrade.s.sol
├── lib/                  # Git submodule dependencies
│   ├── forge-std/
│   └── openzeppelin-contracts/
└── out/                  # Build artifacts (gitignored)
```

## foundry.toml Template

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"

# Solidity compiler
solc_version = "0.8.28"
evm_version = "cancun"       # Latest EVM target
optimizer = true
optimizer_runs = 200          # Balance deploy vs runtime gas
via_ir = false                # Enable for complex contracts / stack too deep

# Compilation
auto_detect_solc = false
build_info = true
extra_output = ["storageLayout"]  # For upgrade safety checks

# Testing
ffi = false                   # Disable FFI by default (security)
verbosity = 2                 # 0=minimal, 3=traces, 5=everything
fuzz = { runs = 256, seed = "0x1" }
invariant = { runs = 256, depth = 50 }
gas_reports = ["*"]

# Formatter
[fmt]
line_length = 100
tab_width = 4
bracket_spacing = false
int_types = "long"            # uint256 not uint
multiline_func_header = "params_first"
number_underscore = "thousands"
single_line_statement_blocks = "preserve"
sort_imports = true

[rpc_endpoints]
mainnet = "${ETH_RPC_URL}"
sepolia = "${SEPOLIA_RPC_URL}"
base = "${BASE_RPC_URL}"
optimism = "${OPTIMISM_RPC_URL}"
arbitrum = "${ARBITRUM_RPC_URL}"
anvil = "http://127.0.0.1:8545"

[etherscan]
mainnet = { key = "${ETHERSCAN_API_KEY}" }
sepolia = { key = "${ETHERSCAN_API_KEY}" }
base = { key = "${BASESCAN_API_KEY}", url = "https://api.basescan.org/api" }
optimism = { key = "${OPSCAN_API_KEY}", url = "https://api-optimistic.etherscan.io/api" }
arbitrum = { key = "${ARBISCAN_API_KEY}", url = "https://api.arbiscan.io/api" }

# CI profile: more fuzz runs
[profile.ci]
fuzz = { runs = 10000 }
invariant = { runs = 1000, depth = 100 }
```

## Remappings

Auto-generate remappings:

```bash
forge remappings > remappings.txt
```

Typical `remappings.txt`:

```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
@openzeppelin/contracts-upgradeable/=lib/openzeppelin-contracts-upgradeable/contracts/
forge-std/=lib/forge-std/src/
```

For VS Code / Solidity extension, add to `settings.json`:

```json
{
  "solidity.remappings": [
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
    "forge-std/=lib/forge-std/src/"
  ]
}
```

## Dependency Management

```bash
# Install a dependency (adds as git submodule)
forge install OpenZeppelin/openzeppelin-contracts

# Install specific version
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0

# Update all dependencies
forge update

# Update specific dependency
forge update lib/openzeppelin-contracts

# Remove dependency
forge remove openzeppelin-contracts
```

## Common Build Commands

```bash
# Build
forge build

# Build with sizes
forge build --sizes

# Clean and rebuild
forge clean && forge build

# Inspect storage layout
forge inspect MyContract storageLayout

# Inspect ABI
forge inspect MyContract abi

# Check contract sizes (24KB limit)
forge build --sizes | grep -E "Contract|─"

# Generate gas snapshot
forge snapshot
```

## Optimizer Settings

| `optimizer_runs` | Optimize for | Use case |
|-----------------|-------------|----------|
| 1 | Deployment cost | Rarely called contracts |
| 200 | Balanced (default) | Most contracts |
| 1000+ | Runtime cost | Frequently called (DEX, vaults) |
| 1000000 | Maximum runtime | Hot paths |

## via-ir Pipeline

Enable `via_ir = true` when:
- Hitting "stack too deep" errors
- Complex contracts with many local variables
- Need advanced optimizations

Tradeoff: significantly slower compilation (~5-10x).

```toml
# Per-profile override for complex contracts
[profile.via-ir]
via_ir = true
optimizer_runs = 200
```

```bash
FOUNDRY_PROFILE=via-ir forge build
```

## .gitignore

```gitignore
# Foundry
out/
cache/
broadcast/*/31337/  # Local anvil broadcasts
broadcast/**/dry-run/

# Environment
.env

# Coverage
lcov.info
coverage/
```

## Environment Setup

```bash
# .env (never commit)
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...
```

Load in scripts:
```bash
source .env
forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL --broadcast
```
