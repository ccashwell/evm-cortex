"""
MCP Server Registry
Known MCP servers and installation info for EVM/Solidity development.
"""

import os
import sys
import json

REGISTRY = {
    "openzeppelin": {
        "name": "OpenZeppelin MCP",
        "command": "npx",
        "args": ["-y", "@openzeppelin/mcp"],
        "description": "Contract generation, best practices, OZ library guidance",
        "project_signals": ["foundry.toml", "hardhat.config.ts", "hardhat.config.js"],
        "install": "npx -y @openzeppelin/mcp",
        "url": "https://mcp.openzeppelin.com/",
    },
    "blockscout": {
        "name": "Blockscout MCP",
        "command": "npx",
        "args": ["-y", "@blockscout/mcp-server"],
        "description": "Onchain data queries, contract source, transaction analysis",
        "project_signals": ["foundry.toml", "hardhat.config.ts"],
        "install": "npx -y @blockscout/mcp-server",
        "url": "https://docs.blockscout.com/",
    },
    "circle": {
        "name": "Circle MCP",
        "url": "https://api.circle.com/v1/codegen/mcp",
        "type": "http",
        "description": "USDC SDK methods, contract addresses, CCTP integration",
        "project_signals": [],
        "install": "Add to mcp.json: {\"circle\": {\"url\": \"https://api.circle.com/v1/codegen/mcp\"}}",
    },
    "github": {
        "name": "GitHub MCP Server",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": ""},
        "description": "GitHub API — repos, issues, PRs, code search",
        "project_signals": [".github/", ".git/"],
        "install": "npx -y @modelcontextprotocol/server-github",
    },
    "filesystem": {
        "name": "Filesystem MCP",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
        "description": "Local filesystem access for reading project files",
        "project_signals": ["*"],
        "install": "npx -y @modelcontextprotocol/server-filesystem",
    },
    "postgres": {
        "name": "PostgreSQL MCP",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": {"DATABASE_URL": ""},
        "description": "PostgreSQL database access (indexer DBs, subgraph stores)",
        "project_signals": ["schema.prisma", "*.sql", "migrations/"],
        "install": "npx -y @modelcontextprotocol/server-postgres",
    },
}


def get_recommendations(project_path: str) -> list:
    """Return MCP recommendations based on project directory contents."""
    recommendations = []

    try:
        project_files = os.listdir(project_path)
    except OSError:
        return recommendations

    for server in REGISTRY.values():
        signals = server.get("project_signals", [])
        if not signals:
            continue

        for signal in signals:
            if signal == "*":
                continue

            if signal.startswith("*"):
                ext = signal.lstrip("*")
                if any(f.endswith(ext) for f in project_files):
                    recommendations.append(server)
                    break
            else:
                check_path = os.path.join(project_path, signal.rstrip("/"))
                if os.path.exists(check_path):
                    recommendations.append(server)
                    break

    return recommendations


def get_installed_mcps() -> dict:
    """Read installed MCP servers from ~/.mcp.json."""
    mcp_path = os.path.join(os.path.expanduser("~"), ".mcp.json")
    if not os.path.exists(mcp_path):
        return {}
    try:
        with open(mcp_path) as f:
            config = json.load(f)
        return config.get("mcpServers", {})
    except (json.JSONDecodeError, OSError):
        return {}


def print_status():
    """Show installed MCP server status."""
    installed = get_installed_mcps()
    if not installed:
        print("No MCP servers installed (~/.mcp.json missing or empty)")
        return

    print(f"Installed MCP servers ({len(installed)}):")
    for name, config in installed.items():
        cmd = config.get("command", config.get("url", "?"))
        args = " ".join(config.get("args", []))
        print(f"  * {name}: {cmd} {args}")


def print_registry():
    """Print the full registry."""
    print(f"MCP Server Registry ({len(REGISTRY)} servers):\n")
    for key, server in REGISTRY.items():
        print(f"  [{key}]")
        print(f"    {server['name']}: {server['description']}")
        print(f"    Install: {server['install']}")
        url = server.get("url")
        if url:
            print(f"    Docs: {url}")
        signals = server.get("project_signals", [])
        if signals:
            print(f"    Signals: {', '.join(signals)}")
        print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python registry.py recommend <path>  — Recommend MCPs for a project")
        print("  python registry.py status             — Show installed MCPs")
        print("  python registry.py list               — Show full registry")
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "recommend":
        path = sys.argv[2] if len(sys.argv) > 2 else "."
        recs = get_recommendations(path)
        if not recs:
            print("No additional MCP recommendations for this project.")
        else:
            print(f"Recommended MCP servers ({len(recs)}):\n")
            for r in recs:
                print(f"  * {r['name']}: {r['description']}")
                print(f"    Install: {r['install']}")
                print()

    elif cmd == "status":
        print_status()

    elif cmd == "list":
        print_registry()

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
