import type { ToolDefinition } from "./types.js";

// Extended tool info with routing data
export interface CachedTool {
  serverName: string;           // Which backend server owns this
  originalName: string;         // Original tool name on that server
  prefixedName: string;         // serverName__originalName
  definition: ToolDefinition;   // Full tool definition
}

// Route info for tool calls
export interface ToolRoute {
  server: string;
  tool: string;
}

/**
 * In-memory cache for all backend tool definitions.
 * Keeps tools server-side so they don't bloat Claude Code's context.
 */
export class ToolCache {
  private tools = new Map<string, CachedTool>();

  /**
   * Add tools from a backend server to the cache.
   * Tool names are prefixed with server name for uniqueness.
   */
  addFromServer(serverName: string, tools: ToolDefinition[]): void {
    for (const tool of tools) {
      const prefixedName = `${serverName}__${tool.name}`;
      this.tools.set(prefixedName, {
        serverName,
        originalName: tool.name,
        prefixedName,
        definition: {
          ...tool,
          name: prefixedName  // Use prefixed name in definition
        }
      });
    }
  }

  /**
   * Get all tool definitions for Bedrock search.
   * Returns definitions with prefixed names.
   */
  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Get a specific cached tool by prefixed name.
   */
  get(prefixedName: string): CachedTool | undefined {
    return this.tools.get(prefixedName);
  }

  /**
   * Get routing info for a tool call.
   * Returns the server name and original tool name.
   */
  getRoute(prefixedName: string): ToolRoute | undefined {
    const cached = this.tools.get(prefixedName);
    if (!cached) return undefined;
    return {
      server: cached.serverName,
      tool: cached.originalName
    };
  }

  /**
   * Get total number of cached tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Get list of all tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.tools.clear();
  }
}
