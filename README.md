# MCP Tool Proxy with Bedrock Tool Search

An MCP proxy server that reduces Claude Code's context window usage by keeping tool definitions server-side and using AWS Bedrock's tool search to find relevant tools on-demand.

## Problem

With 50+ tools from multiple MCP servers, Claude Code's context becomes bloated (~10,000 tokens). This proxy keeps tools server-side and only exposes 2 tools to Claude Code.

## Architecture

```
Claude Code → Tool Proxy (2 tools in context)
                   |
                   ├── search_tools(query) → Bedrock tool search → returns tool names
                   ├── call_tool(name, args) → routes to backend
                   |
                   └── Backend MCP servers (tools cached server-side)
```

## Prerequisites

- Node.js 20+
- AWS account with Bedrock access
- Claude Opus 4.5 model enabled in Bedrock
- AWS credentials configured

## Installation

```bash
npm install
npm run build
```

## Configuration

### Backend Servers (`proxy-config.json`)

Configure backend MCP servers to proxy:

```json
{
  "backends": {
    "aws-knowledge": {
      "url": "https://knowledge-mcp.global.api.aws",
      "type": "http"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

### Claude Code (`.mcp.json`)

Configure Claude Code to connect only to the proxy:

```json
{
  "mcpServers": {
    "tool-proxy": {
      "command": "npx",
      "args": ["-y", "tool-search-bedrock-mcp"]
    }
  }
}
```

## Usage

The proxy exposes 2 tools:

### `search_tools`

Search for relevant tools by query:

```json
{
  "query": "I need to search AWS documentation",
  "max_results": 5
}
```

Returns tool names that can be used with `call_tool`.

### `call_tool`

Execute a discovered tool:

```json
{
  "tool_name": "aws-knowledge__aws___search_documentation",
  "arguments": {
    "search_phrase": "Lambda best practices"
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_CONFIG` | `./proxy-config.json` | Path to backend config |
| `AWS_REGION` | `us-west-2` | AWS region for Bedrock |
| `AWS_PROFILE` | `claude_code` | AWS credentials profile |
| `GITHUB_PAT` | - | GitHub personal access token for GitHub MCP backend (optional for demo) |
