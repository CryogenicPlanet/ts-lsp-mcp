# TypeScript LSP MCP Server

This project provides a Model Context Protocol (MCP) server that lets models call into the TypeScript language service powered by the native `tsgo` toolchain. The server launches `tsgo`'s Language Server Protocol (LSP) implementation over stdio and exposes a curated set of analysis tools (hover, definitions, references, symbols, diagnostics) through MCP tools. The goal is to keep TypeScript-aware assistance lightweight and fast by building on the Go-based TypeScript native preview.

## Features

- Uses the `tsgo` native TypeScript compiler and LSP for improved responsiveness.
- MCP tools for hover, definitions, references, document symbols, and diagnostics.
- Automatic document syncing (open/change) based on on-disk files in the configured workspace.
- CLI wrapper with configurable `tsgo` binary path and extra arguments.

## Requirements

- **Node.js** ≥ 20.10 (matching the `engines` constraint in `package.json`).
- **tsgo binary** from the TypeScript Native Preview package: `npm install -g @typescript/native-preview` (or `bun add -g @typescript/native-preview`) provides the required `tsgo` executable.
- `tsgo` must support running the LSP over stdio (`tsgo --lsp --stdio`).

## Installation

### Option 1: One-line install script

```bash
curl -fsSL https://raw.githubusercontent.com/CryogenicPlanet/ts-lsp-mcp/main/scripts/install.sh | bash
```

The script downloads the latest nightly build, installs it to `~/.ts-lsp-mcp/ts-lsp-mcp`, and prints a short snippet you can add to your shell profile to expose the binary on your `PATH`. If you have not already installed the TypeScript native preview, run `npm install -g @typescript/native-preview` (or the Bun equivalent) after the script completes.

### Option 2: Build from source with Bun

```bash
bun install
bun run src/cli.ts --workspace /absolute/path/to/your/project   # development

# build a standalone binary
bun build src/cli.ts --compile --outfile dist/ts-lsp-mcp
```

The CLI defaults `--workspace` to the current directory. Pass an explicit path when you want to inspect a different project.

After installation, you can run the server directly:

```bash
ts-lsp-mcp --workspace "$(pwd)"
```

The `--workspace` flag defaults to the current working directory when omitted, so `ts-lsp-mcp` alone is usually enough.

### MCP client integration

If `ts-lsp-mcp` is on your `PATH`, use `"command": ["ts-lsp-mcp", …]` in the snippets below. Otherwise, replace it with the absolute path printed by the installer.

<details>
<summary><strong>Cursor</strong></summary>

Create or update `~/.cursor/mcp.json`:

```json
{
  "ts-lsp-mcp": {
    "command": [
      "ts-lsp-mcp",
      "--workspace",
      "$(pwd)"
    ]
  }
}
```

</details>

<details>
<summary><strong>Claude Code (Claude Desktop)</strong></summary>

Create `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows/WSL) with:

```json
{
  "mcpServers": {
    "ts-lsp-mcp": {
      "command": "ts-lsp-mcp",
      "args": [
        "--workspace",
        "$(pwd)"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>OpenAI Codex CLI</strong></summary>

Add a server entry via `/mcp`:

```json
{
  "ts": {
    "command": "ts-lsp-mcp",
    "args": [
      "--workspace",
      "$(pwd)"
    ]
  }
}
```

</details>

<details>
<summary><strong>Google Gemini CLI</strong></summary>

Edit `~/.config/gemini/mcp.json` (or equivalent):

```json
{
  "servers": {
    "ts-lsp-mcp": {
      "command": "ts-lsp-mcp",
      "args": [
        "--workspace",
        "$(pwd)"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Continue (VS Code / JetBrains)</strong></summary>

Add to `~/.continue/config.json`:

```json
{
  "mcpServers": {
    "ts-lsp-mcp": {
      "command": "ts-lsp-mcp",
      "args": [
        "--workspace",
        "$(pwd)"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code (Model Context Protocol Extension)</strong></summary>

Add to your VS Code settings (`settings.json`):

```json
{
  "modelContextProtocol.servers": {
    "ts-lsp-mcp": {
      "command": "ts-lsp-mcp",
      "args": [
        "--workspace",
        "$(pwd)"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Zed</strong></summary>

Add to `~/.config/zed/mcp.toml`:

```toml
[servers.ts-lsp-mcp]
command = "ts-lsp-mcp"
args = ["--workspace", "$(pwd)"]
```

</details>

Each client substitutes `${workspaceFolder}` (or its equivalent) with the project you open, so the same configuration works across repositories.

### CLI Options

- `--workspace <path>`: Root directory for files the LSP should analyze (defaults to current directory).
- `--tsgo <path>`: Path to the `tsgo` executable (defaults to `tsgo` on `PATH`).
- `--tsgo-arg <value...>`: Extra arguments forwarded to `tsgo lsp --stdio` (repeatable).
- `--log-level <debug|info|warn|error>`: Minimum log verbosity (defaults to `info`).

The server will eagerly initialize the TypeScript LSP and then start listening for MCP requests on stdio.

## MCP Tooling Overview

| Tool name | Description |
|-----------|-------------|
| `typescript-hover` | Returns hover text and markdown at a zero-indexed position. |
| `typescript-definition` | Lists definition locations for a symbol. |
| `typescript-references` | Finds references (optionally including the declaration). |
| `typescript-document-symbols` | Dumps hierarchical document symbols. |
| `typescript-diagnostics` | Fetches the latest diagnostics published by the LSP for a file. |

The GitHub workflow in `.github/workflows/release.yml` publishes nightly binaries (`latest` release tag) for macOS (arm64/x64) and Linux (x64/arm64). The install script above pulls from that release by default.

All file paths must be within the configured workspace. Lines and characters are zero-indexed to match the LSP protocol.

## Example MCP Client Configuration

Example JSON fragment for a client that reads server definitions from `~/.config/mcp/servers`:

```json
{
  "name": "ts-lsp-mcp",
  "command": [
    "node",
    "/Users/you/path/to/ts-lsp-mcp/dist/cli.js",
    "--workspace",
    "/Users/you/path/to/workspace"
  ],
  "env": {
    "PATH": "/Users/you/.npm-global/bin:"  // ensure tsgo is discoverable
  }
}
```

Adjust the paths for your environment. If `tsgo` is not on your `PATH`, either point `--tsgo` at the executable or set `PATH` accordingly.

## Development

- `npm run dev`: incremental TypeScript build (`tsc --watch`).
- `npm run build`: one-off TypeScript build.

## Limitations

The native `tsgo` toolchain is still a preview: several TypeScript CLI flags (e.g., `--build`, declaration emit) and some editor features remain unimplemented. Expect differences versus the stable JavaScript-based compiler and plan to update as the preview evolves.

## How the stdio transport works

The server uses the MCP `StdioServerTransport`, so it communicates over standard input/output. MCP clients (such as Anthropics’ Cursor or Claude Code integrations) typically launch the executable, wire its stdout/stdin to the IDE session, and send protocol messages that include the workspace paths they want the server to see. That means each IDE session or model invocation spins up its own process with a working directory rooted in the project it needs, enabling the “current folder” behaviour without additional configuration.
