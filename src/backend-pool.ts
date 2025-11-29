import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFile } from "fs/promises";
import type { ToolDefinition } from "./types.js";
import { ToolCache } from "./tool-cache.js";

// Backend server configuration
export interface BackendServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: "http" | "stdio";
  headers?: Record<string, string>;
}

// Proxy configuration file format
export interface ProxyConfig {
  backends: Record<string, BackendServerConfig>;
}

// Connected backend client
interface BackendClient {
  client: Client;
  config: BackendServerConfig;
}

// Substitute ${VAR} with environment variables
function substituteEnvVars(text: string): string {
  return text.replace(/\$\{(\w+)\}/g, (_, varName) => process.env[varName] || "");
}

/**
 * Manages persistent connections to backend MCP servers.
 * Handles tool discovery and proxied tool calls.
 */
export class BackendPool {
  private clients = new Map<string, BackendClient>();
  private toolCache: ToolCache;

  constructor(toolCache: ToolCache) {
    this.toolCache = toolCache;
  }

  /**
   * Initialize the pool from a config file.
   * Connects to all backends and caches their tools.
   */
  async initialize(configPath: string): Promise<void> {
    const raw = await readFile(configPath, "utf-8");
    const substituted = substituteEnvVars(raw);
    const config: ProxyConfig = JSON.parse(substituted);

    for (const [serverName, serverConfig] of Object.entries(config.backends)) {
      try {
        console.error(`[backend-pool] Connecting to ${serverName}...`);
        await this.connectServer(serverName, serverConfig);
        console.error(`[backend-pool]   Connected to ${serverName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backend-pool]   Failed to connect to ${serverName}: ${msg}`);
      }
    }

    console.error(`[backend-pool] Initialized with ${this.toolCache.size} tools from ${this.clients.size} backends`);
  }

  /**
   * Connect to a single backend server and cache its tools.
   */
  private async connectServer(serverName: string, config: BackendServerConfig): Promise<void> {
    let transport;

    if (config.type === "http" || config.url) {
      // HTTP transport for remote servers
      transport = new StreamableHTTPClientTransport(new URL(config.url!), {
        requestInit: config.headers ? { headers: config.headers } : undefined
      });
    } else {
      // Stdio transport for local subprocess servers
      transport = new StdioClientTransport({
        command: config.command!,
        args: config.args || [],
        env: { ...process.env, ...config.env } as Record<string, string>,
        cwd: config.cwd
      });
    }

    const client = new Client(
      { name: "tool-proxy", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    // Get tools and cache them
    const { tools } = await client.listTools();
    const toolDefs: ToolDefinition[] = tools.map(tool => ({
      name: tool.name,
      description: tool.description || "",
      input_schema: (tool.inputSchema as Record<string, unknown>) || { type: "object", properties: {} }
    }));

    this.toolCache.addFromServer(serverName, toolDefs);
    this.clients.set(serverName, { client, config });

    console.error(`[backend-pool]   Cached ${toolDefs.length} tools from ${serverName}`);
  }

  /**
   * Call a tool on a specific backend server.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const backend = this.clients.get(serverName);
    if (!backend) {
      throw new Error(`Backend server not found: ${serverName}`);
    }

    const result = await backend.client.callTool({
      name: toolName,
      arguments: args
    });

    return result;
  }

  /**
   * Get list of connected backend server names.
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Close all backend connections.
   */
  async close(): Promise<void> {
    for (const [serverName, backend] of this.clients) {
      try {
        await backend.client.close();
        console.error(`[backend-pool] Closed connection to ${serverName}`);
      } catch (err) {
        console.error(`[backend-pool] Error closing ${serverName}:`, err);
      }
    }
    this.clients.clear();
  }
}
