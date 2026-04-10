# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in EVM Cortex, please report it responsibly.

**Do NOT open a public issue for security vulnerabilities.**

### How to Report

1. Open a private security advisory on [GitHub](https://github.com/ccashwell/evm-cortex/security/advisories/new)
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment:** Within 48 hours
- **Assessment:** Within 7 days
- **Fix:** Depending on severity, within 7-30 days
- **Disclosure:** After the fix is released

### Scope

The following are in scope:
- Hook code execution (TypeScript hooks in `hooks/src/`)
- `install.sh` script security
- Agent prompt injection vulnerabilities
- Credential/secret exposure in any files
- Solidity code examples that contain security anti-patterns

The following are out of scope:
- Issues in Claude Code itself (report to [Anthropic](https://github.com/anthropics/claude-code/issues))
- Social engineering attacks
- Denial of service

### Security Best Practices for Contributors

- Never commit secrets, API keys, private keys, or credentials
- All hooks run in the user's shell context — be careful with `Bash` tool calls
- Agent prompts should not instruct bypassing security controls
- Review `install.sh` changes carefully — it runs with user privileges
- Solidity examples must follow checks-effects-interactions pattern
- Never include real private keys or mnemonics in examples

## Hall of Fame

We appreciate security researchers who help keep EVM Cortex safe. Responsible reporters will be credited here (with permission).
