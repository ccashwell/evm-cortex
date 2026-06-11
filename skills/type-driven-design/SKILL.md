---
name: type-driven-design
description: Design Solidity contracts using type-driven composition instead of inheritance. Structs encapsulate storage, free functions define behavior via `using for global`, and contracts become thin external shells. Eliminates inheritance hell, exposes the full interface explicitly, and enables granular isolated testing at every layer of composition. Based on JT Riley's type-driven-tokens pattern.
---

# Type-Driven Solidity Design

Type-driven design replaces object inheritance with struct composition and free functions. Instead of deep inheritance trees where storage layouts are hidden and method overriding is opaque, each data concern is a standalone struct with free functions bound via `using ... for ... global`. Contracts compose these types and serve only as the external interface.

Reference implementation: [jtriley2p/type-driven-tokens](https://github.com/jtriley2p/type-driven-tokens)

## Why This Matters

Inheritance-based Solidity creates problems that compound as protocols grow:

- **Hidden interfaces** — parent contracts add external/public functions implicitly
- **Storage layout opacity** — storage slots are scattered across an inheritance tree
- **Method override fragility** — `virtual`/`override` chains break silently on refactor
- **Testing requires mocks** — abstract contracts can't be tested without mock inheritors
- **Inheritance hell** — diamond inheritance, linearization surprises, C3 ambiguity

Type-driven design eliminates all of these. The entire external interface is explicit in one contract. Storage is visible as struct composition. Each component is independently testable without mocks.

## Core Principles

### 1. Types Encapsulate Storage

Each struct wraps the minimum storage it needs. The internal field is private by convention (`_inner`).

```solidity
struct Balances {
    mapping(address => uint256) _inner;
}

struct TotalSupply {
    uint256 _inner;
}

struct Allowances {
    mapping(address => mapping(address => uint256)) _inner;
}

struct Operators {
    mapping(address => mapping(address => bool)) _inner;
}
```

### 2. Free Functions Define Behavior

Behavior is defined as free functions (file-level, outside any contract) bound to the struct with `using ... for ... global`. Every mutating function takes `Type storage self` and returns `Type storage` for fluent chaining.

```solidity
using { read, write, increase, decrease } for Balances global;

function read(Balances storage self, address account) view returns (uint256) {
    return self._inner[account];
}

function write(Balances storage self, address account, uint256 amount) returns (Balances storage) {
    self._inner[account] = amount;
    return self;
}

function increase(Balances storage self, address account, uint256 amount) returns (Balances storage) {
    self._inner[account] += amount;
    return self;
}

function decrease(Balances storage self, address account, uint256 amount) returns (Balances storage) {
    self._inner[account] -= amount;
    return self;
}
```

### 3. Compose Types Into Higher-Level Types

Higher-level types compose primitives. A `Token` is just `Balances` + `Allowances` + `TotalSupply`. Its free functions delegate to the inner types.

```solidity
struct Token {
    Allowances allowances;
    Balances balances;
    TotalSupply supply;
}

using { balanceOf, totalSupply, allowance, mint, burn, transfer, transferFrom, approve } for Token global;

function mint(Token storage self, address receiver, uint256 amount) returns (Token storage) {
    self.balances.increase(receiver, amount);
    self.supply.increase(amount);
    return self;
}

function transfer(
    Token storage self,
    address sender,
    address receiver,
    uint256 amount
) returns (Token storage) {
    self.balances.decrease(sender, amount);
    self.balances.increase(receiver, amount);
    return self;
}

function transferFrom(
    Token storage self,
    address spender,
    address sender,
    address receiver,
    uint256 amount
) returns (Token storage) {
    if (spender != sender) self.allowances.decrease(sender, spender, amount);
    self.balances.decrease(sender, amount);
    self.balances.increase(receiver, amount);
    return self;
}
```

Multi-token types compose further — a `MultiToken` maps token IDs to `Token` instances and adds an `Operators` layer:

```solidity
struct MultiToken {
    mapping(uint256 => Token) tokens;
    Operators operators;
}

using { balanceOf, totalSupply, mint, burn, transfer, transferFrom, approve, setOperator } for MultiToken global;

function transfer(
    MultiToken storage self,
    uint256 id,
    address sender,
    address receiver,
    uint256 amount
) returns (MultiToken storage) {
    self.tokens[id].transfer(sender, receiver, amount);
    return self;
}
```

### 4. Contracts Are Thin Shells

The contract's only job is to wire `msg.sender`, emit events, enforce access control, and expose the external interface. All logic lives in the type layer.

```solidity
contract ERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    Token internal self;

    function transfer(address receiver, uint256 amount) public returns (bool) {
        self.transfer(msg.sender, receiver, amount);
        emit Transfer(msg.sender, receiver, amount);
        return true;
    }

    function transferFrom(address sender, address receiver, uint256 amount) public returns (bool) {
        self.transferFrom(msg.sender, sender, receiver, amount);
        emit Transfer(sender, receiver, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        self.approve(msg.sender, spender, amount);
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}
```

## File Organization

```
src/
├── types/
│   ├── Balances.sol        # Primitive: address → uint256 mapping
│   ├── Allowances.sol      # Primitive: owner → spender → uint256
│   ├── TotalSupply.sol     # Primitive: single uint256
│   ├── Operators.sol       # Primitive: owner → operator → bool
│   ├── Token.sol           # Composed: Balances + Allowances + TotalSupply
│   └── MultiToken.sol      # Composed: mapping(id => Token) + Operators
├── ERC20.sol               # Contract shell using Token
└── ERC6909.sol             # Contract shell using MultiToken
test/
├── Balances.t.sol          # Test primitive in isolation
├── Allowances.t.sol        # Test primitive in isolation
├── TotalSupply.t.sol       # Test primitive in isolation
├── Operators.t.sol         # Test primitive in isolation
├── Token.t.sol             # Test composed type
└── ERC20.t.sol             # Test external interface
```

Each type lives in its own file. Each composed type imports its dependencies. The contract imports only the top-level composed type.

## Testing Strategy

The key advantage: every layer is independently testable without mock contracts.

### Test Primitives in Isolation

Declare the type as a storage variable directly in the test contract. No mock, no inheritance, no factory.

```solidity
contract BalancesTest is Test {
    Balances internal balances;
    address internal alice = vm.addr(1);

    function testIncrease() public {
        balances.increase(alice, 100);
        assertEq(balances.read(alice), 100);
    }

    function testDecreaseUnderflow() public {
        vm.expectRevert();
        balances.decrease(alice, 1);
    }

    function testFuzzIncrease(address account, uint256 a, uint256 b) public {
        bool overflow = type(uint256).max - a < b;
        balances.increase(account, a);
        if (overflow) vm.expectRevert();
        balances.increase(account, b);
        if (!overflow) assertEq(balances.read(account), a + b);
    }
}
```

### Test Composed Types

The composed type is also just a storage variable. Test its functions, which delegate to the primitives. Use `.write()` on inner types for state setup.

```solidity
contract TokenTest is Test {
    Token internal token;
    address internal alice = vm.addr(1);
    address internal bob = vm.addr(2);

    function testMint() public {
        token.mint(alice, 100);
        assertEq(token.balanceOf(alice), 100);
        assertEq(token.totalSupply(), 100);
    }

    function testTransferFrom() public {
        token.mint(alice, 100);
        token.approve(alice, bob, 50);
        token.transferFrom(bob, alice, bob, 50);
        assertEq(token.balanceOf(bob), 50);
        assertEq(token.allowance(alice, bob), 0);
    }

    function testFuzzTransfer(address sender, address receiver, uint256 mintAmt, uint256 xferAmt) public {
        vm.assume(sender != receiver);
        bool underflow = mintAmt < xferAmt;
        token.mint(sender, mintAmt);
        if (underflow) vm.expectRevert();
        token.transfer(sender, receiver, xferAmt);
        if (!underflow) {
            assertEq(token.balanceOf(sender), mintAmt - xferAmt);
            assertEq(token.balanceOf(receiver), xferAmt);
        }
    }
}
```

### Test the Contract Shell

Only test the external interface (events, `msg.sender` wiring, return values). All logic was already tested at the type layer.

## Designing Your Own Types

### Step 1 — Identify Storage Concerns

Break your protocol into its independent data concerns. Each mapping, counter, or flag set becomes its own primitive type.

| Data Concern | Struct | Internal Storage |
|---|---|---|
| Per-user balances | `Balances` | `mapping(address => uint256)` |
| Approval matrix | `Allowances` | `mapping(address => mapping(address => uint256))` |
| Global counter | `TotalSupply` | `uint256` |
| Boolean permission | `Operators` | `mapping(address => mapping(address => bool))` |
| Nonce tracking | `Nonces` | `mapping(address => uint256)` |
| Timelocked value | `Timelock` | `struct { uint256 value; uint48 unlockTime; }` |
| Role membership | `Roles` | `mapping(bytes32 => mapping(address => bool))` |

### Step 2 — Define Primitive Operations

Each primitive gets the minimum operations it needs. Follow a consistent pattern:

| Operation | Signature Pattern | Returns |
|---|---|---|
| Read | `read(T storage self, ...) view returns (ValueType)` | The stored value |
| Write | `write(T storage self, ..., value) returns (T storage)` | Self for chaining |
| Increase | `increase(T storage self, ..., amount) returns (T storage)` | Self for chaining |
| Decrease | `decrease(T storage self, ..., amount) returns (T storage)` | Self for chaining |

Not every type needs all four. A boolean toggle only needs `read` and `write`. A monotonic counter might only need `read` and `increase`.

### Step 3 — Compose Into Domain Types

Compose primitives into types that represent your domain concepts. The composed type's functions express business logic by orchestrating calls to its inner types.

```solidity
struct Vault {
    Balances shares;
    Balances assets;
    TotalSupply totalShares;
    TotalSupply totalAssets;
}

using { deposit, withdraw, sharePrice } for Vault global;

function deposit(Vault storage self, address depositor, uint256 assetAmount) returns (Vault storage) {
    uint256 shareAmount = _convertToShares(self, assetAmount);
    self.assets.increase(depositor, assetAmount);
    self.totalAssets.increase(assetAmount);
    self.shares.increase(depositor, shareAmount);
    self.totalShares.increase(shareAmount);
    return self;
}

function sharePrice(Vault storage self) view returns (uint256) {
    uint256 supply = self.totalShares.read();
    if (supply == 0) return 1e18;
    return (self.totalAssets.read() * 1e18) / supply;
}
```

### Step 4 — Write the Contract Shell

The contract handles only what free functions cannot:

- **`msg.sender`** — free functions don't have access to the execution context
- **Events** — free functions can't emit events
- **Access control** — `require`/`revert` with caller checks
- **External interfaces** — `public`/`external` function signatures matching the EIP

### Step 5 — Test Bottom-Up

1. Test each primitive type in isolation (read, write, increase, decrease, overflow, underflow)
2. Test each composed type (business logic, invariant preservation)
3. Test the contract shell (events, access control, msg.sender wiring)
4. Fuzz at every level — primitive fuzz tests are cheap and catch edge cases early

## Patterns for Common Concerns

### Access Control

```solidity
struct Owner {
    address _inner;
}

using { read, write, onlyOwner } for Owner global;

function read(Owner storage self) view returns (address) {
    return self._inner;
}

function write(Owner storage self, address newOwner) returns (Owner storage) {
    self._inner = newOwner;
    return self;
}

function onlyOwner(Owner storage self, address caller) view {
    require(caller == self._inner, "not owner");
}
```

### Reentrancy Guard

```solidity
struct Lock {
    uint256 _inner;
}

using { acquire, release } for Lock global;

function acquire(Lock storage self) returns (Lock storage) {
    require(self._inner == 0, "locked");
    self._inner = 1;
    return self;
}

function release(Lock storage self) returns (Lock storage) {
    self._inner = 0;
    return self;
}
```

### Nonces (Replay Protection)

```solidity
struct Nonces {
    mapping(address => uint256) _inner;
}

using { current, use } for Nonces global;

function current(Nonces storage self, address account) view returns (uint256) {
    return self._inner[account];
}

function use(Nonces storage self, address account) returns (uint256 nonce) {
    nonce = self._inner[account];
    self._inner[account] = nonce + 1;
}
```

### Pausable

```solidity
struct Paused {
    bool _inner;
}

using { isPaused, pause, unpause, whenNotPaused } for Paused global;

function isPaused(Paused storage self) view returns (bool) {
    return self._inner;
}

function pause(Paused storage self) returns (Paused storage) {
    self._inner = true;
    return self;
}

function unpause(Paused storage self) returns (Paused storage) {
    self._inner = false;
    return self;
}

function whenNotPaused(Paused storage self) view {
    require(!self._inner, "paused");
}
```

### Full Protocol Composition

```solidity
struct ProtocolStore {
    Owner owner;
    Lock lock;
    Paused paused;
    Token token;
    Nonces nonces;
}

contract Protocol {
    ProtocolStore internal self;

    function transfer(address to, uint256 amount) external {
        self.paused.whenNotPaused();
        self.lock.acquire();
        self.token.transfer(msg.sender, to, amount);
        self.lock.release();
        emit Transfer(msg.sender, to, amount);
    }

    function pause() external {
        self.owner.onlyOwner(msg.sender);
        self.paused.pause();
    }
}
```

## Rules

1. **One struct per storage concern.** If two mappings serve different purposes, they get different types.
2. **Free functions only.** No methods on contracts or abstract contracts for core logic.
3. **`using for global`** so the functions are available everywhere without import boilerplate.
4. **Mutators return `self`** for fluent chaining. View functions return the value.
5. **No inheritance.** Zero `is` relationships. The contract composes its store as a single struct.
6. **Contracts are thin.** They wire `msg.sender`, emit events, enforce access control, and nothing else.
7. **Test bottom-up.** Primitives first, compositions second, contract shell last.
8. **Fuzz everything.** Primitive types are especially cheap to fuzz — overflow, underflow, and boundary conditions.

## When to Use This Pattern

**Good fit:**
- Token standards (ERC-20, ERC-721, ERC-1155, ERC-6909)
- Vault/staking contracts with share accounting
- Protocols with clearly separable data concerns
- Systems where testing granularity matters
- Greenfield contracts where you control the architecture

**Less ideal:**
- Integrating with existing inheritance-based libraries (OpenZeppelin)
- Contracts that must inherit from required base contracts (ERC-721Receiver callbacks)
- Very simple single-purpose contracts where the overhead isn't justified

## Comparison With Inheritance

| Aspect | Inheritance | Type-Driven |
|---|---|---|
| Interface visibility | Hidden across parents | Fully explicit in contract |
| Storage layout | Scattered across tree | Visible as struct composition |
| Method override | `virtual`/`override` chains | No overrides — replace the function |
| Testing | Requires mock contracts | Direct storage variable in test |
| Code reuse | `is BaseContract` | `using Lib for Type global` |
| Refactoring risk | C3 linearization surprises | Swap a type, fix compile errors |
| Composability | Multiple inheritance limits | Arbitrary struct nesting |
