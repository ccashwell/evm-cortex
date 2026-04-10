# Contributing to EVM Cortex

Thanks for considering contributing! Here's how you can help build the Ethereum protocol engineering squad.

## Ways to Contribute

### Add New Agents

Create a `.md` file in `agents/` with YAML frontmatter:

```yaml
---
name: my-agent
description: "What this agent does — one clear sentence"
model: sonnet
tools: [Read, Write, Edit, Bash, Grep, Glob]
---

Your agent prompt here. Be specific about the Ethereum-focused role,
expertise areas, methodology, and output format.
```

**Fields:**
- `name` (required): kebab-case identifier
- `description` (required): role description
- `model` (optional): `opus` (complex reasoning) or `sonnet` (fast execution). Default: sonnet
- `tools` (optional): subset of Read, Write, Edit, Bash, Grep, Glob, Task

### Add New Skills

Create a directory in `skills/` with a `SKILL.md`:

```yaml
---
name: my-skill
description: "When to use this skill and what domain knowledge it provides"
---

Skill content — Solidity patterns, protocol mechanics, math formulas,
security patterns, deployment procedures, contract addresses, etc.
```

**Fields:**
- `name` (required): kebab-case identifier
- `description` (required): what this skill covers and when to use it

**Quality requirements:**
- All Solidity examples must compile against real contracts
- Contract addresses must be verified on Etherscan — never hallucinated
- Import paths must match actual package structure (e.g., `v4-core/src/libraries/TickMath.sol`)
- Math formulas must be correct and consistent with protocol implementations

### Improve Hooks

TypeScript hooks live in `hooks/src/`. Each hook is a separate ESM module.

**Development workflow:**

```bash
cd hooks
npm install          # install dev dependencies
npm run build        # compile TypeScript to dist/*.mjs
npm test             # run unit tests
npm run test:watch   # watch mode
```

**EVM-specific hooks we'd welcome:**
- Aderyn static analysis integration
- Foundry coverage check on test file edits
- ABI compatibility checker for upgradeable contracts
- Invariant test runner on contract changes

### Add New Rules

Create a `.md` file in `rules/` for EVM-specific development guidelines:

```markdown
# Rule Name

## When to Apply
Describe when this rule is relevant.

## Guidelines
Specific, actionable rules with Solidity examples.

## Checklist
- [ ] Concrete items to verify
```

### Testing

```bash
cd hooks
npm test                    # run all tests
npm run test:watch          # watch mode
npm run check               # TypeScript type check
```

Tests live in `hooks/src/__tests__/`. Use vitest:

```typescript
import { describe, it, expect } from 'vitest';

describe('my-feature', () => {
  it('does the thing', () => {
    expect(myFunction()).toBe(expected);
  });
});
```

### Documentation

- Improve existing agent/skill content with deeper protocol knowledge
- Add worked examples to math-heavy skills
- Add production deployment addresses for new chains
- See [ARCHITECTURE.md](ARCHITECTURE.md) for system design overview

### Bug Reports & Feature Requests

Open an issue using the provided templates. Include your OS and Node.js version.

## Development Setup

```bash
git clone https://github.com/ccashwell/evm-cortex.git
cd evm-cortex
./install.sh
```

### Prerequisites

- **Foundry**: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Slither** (optional): `pip install slither-analyzer`
- **Node.js** >= 18 (for hook compilation)

## Pull Request Process

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-new-agent`)
3. Write tests for hook changes
4. Commit with clear messages (`feat:`, `fix:`, `docs:`, `audit:`, etc.)
5. Push and open a PR against `main`
6. Describe what you added and why
7. CI will validate frontmatter, lint markdown, and run tests

## Code Style

- **Agents**: Markdown + YAML frontmatter. Ethereum-specific expertise.
- **Skills**: Markdown (`SKILL.md`) + YAML frontmatter. Production-accurate domain knowledge.
- **Hooks**: TypeScript (ES2022, NodeNext modules), built with esbuild.
- **Rules**: Markdown. Solidity/EVM-focused development guidelines.
- **Solidity examples**: Must use correct imports, custom errors, NatSpec, checks-effects-interactions.

## Good First Issues

Look for issues labeled `good first issue`:
- Add a missing agent for a specific Ethereum domain
- Improve a skill with deeper protocol knowledge or more examples
- Add production contract addresses for new chains
- Add test coverage for a hook utility
- Improve NatSpec examples in the solidity-style-guide rule

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
