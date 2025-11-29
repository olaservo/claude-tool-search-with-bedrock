#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { invokeWithToolSearch, extractToolReferences } from "./bedrock-client.js";
import { ToolCache } from "./tool-cache.js";
import { BackendPool } from "./backend-pool.js";
import type { ToolSearchType } from "./types.js";

// Global instances
const toolCache = new ToolCache();
const backendPool = new BackendPool(toolCache);

// Tool definitions - only these 2 tools are exposed to Claude Code
const SEARCH_TOOLS: Tool = {
  name: "search_tools",
  description: "Search for relevant tools from the proxy's backend servers. Returns tool names that can be used with call_tool. Use this to discover what tools are available for your task.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language description of what you want to do"
      },
      max_results: {
        type: "number",
        description: "Maximum number of tools to return (default: 5)"
      }
    },
    required: ["query"]
  }
};

const CALL_TOOL: Tool = {
  name: "call_tool",
  description: "Execute a tool discovered via search_tools. Pass the exact tool name returned by search_tools.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description: "The tool name returned by search_tools (format: server__toolname)"
      },
      arguments: {
        type: "object",
        description: "Arguments to pass to the tool"
      }
    },
    required: ["tool_name", "arguments"]
  }
};

// Server setup
const server = new Server(
  {
    name: "tool-proxy",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: "This is a tool proxy server. Use search_tools to find relevant tools, then call_tool to execute them. Tools are loaded from backend MCP servers.",
  }
);

// List available tools - only exposes search_tools and call_tool
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SEARCH_TOOLS, CALL_TOOL],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // search_tools: Use Bedrock tool search to find relevant tools
  if (name === "search_tools") {
    try {
      const { query, max_results } = args as { query: string; max_results?: number };

      if (!query) {
        return {
          content: [{ type: "text", text: "Error: query parameter is required" }],
          isError: true,
        };
      }

      const allTools = toolCache.getAllDefinitions();
      if (allTools.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "No tools available. Backend servers may not be connected.",
              tool_references: []
            }, null, 2)
          }],
        };
      }

      const maxResults = max_results || 5;
      const searchType: ToolSearchType = "tool_search_tool_regex";

      console.error(`[search_tools] Searching ${allTools.length} tools with query: "${query}"`);

      // Call Bedrock with tool search enabled
      const response = await invokeWithToolSearch(
        [{ role: "user", content: [{ type: "text", text: query }] }],
        allTools,
        searchType
      );

      // Extract tool references from response
      const toolRefs = extractToolReferences(response, maxResults);

      console.error(`[search_tools] Found ${toolRefs.length} matching tools: ${toolRefs.join(", ")}`);

      // Return tool names and brief descriptions
      const results = toolRefs.map(ref => {
        const cached = toolCache.get(ref);
        return {
          name: ref,
          description: cached?.definition.description?.substring(0, 200) || ""
        };
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            tool_references: toolRefs,
            tools: results,
            query,
            total_tools_available: allTools.length
          }, null, 2)
        }],
      };
    } catch (error) {
      console.error("[search_tools] Error:", error);
      return {
        content: [{
          type: "text",
          text: `Error searching tools: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true,
      };
    }
  }

  // call_tool: Route to appropriate backend server
  if (name === "call_tool") {
    try {
      const { tool_name, arguments: toolArgs } = args as {
        tool_name: string;
        arguments: Record<string, unknown>;
      };

      if (!tool_name) {
        return {
          content: [{ type: "text", text: "Error: tool_name parameter is required" }],
          isError: true,
        };
      }

      // Get routing info
      const route = toolCache.getRoute(tool_name);
      if (!route) {
        return {
          content: [{
            type: "text",
            text: `Error: Unknown tool "${tool_name}". Use search_tools to find available tools.`
          }],
          isError: true,
        };
      }

      console.error(`[call_tool] Routing ${tool_name} → ${route.server}::${route.tool}`);

      // Call the backend
      const result = await backendPool.callTool(route.server, route.tool, toolArgs || {});

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
      };
    } catch (error) {
      console.error("[call_tool] Error:", error);
      return {
        content: [{
          type: "text",
          text: `Error calling tool: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// Server startup
async function runServer() {
  // Get config path from environment or use default
  const configPath = process.env.PROXY_CONFIG || "./proxy-config.json";

  console.error("[tool-proxy] Starting Tool Proxy MCP Server...");
  console.error(`[tool-proxy] Loading backend config from: ${configPath}`);

  // Initialize backend connections
  try {
    await backendPool.initialize(configPath);
  } catch (error) {
    console.error("[tool-proxy] Warning: Failed to load backends:", error);
    console.error("[tool-proxy] Server will start but no tools will be available");
  }

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[tool-proxy] Tool Proxy MCP Server running on stdio");
  console.error(`[tool-proxy] ${toolCache.size} tools available from ${backendPool.getConnectedServers().length} backends`);
}

// Handle shutdown
process.on("SIGINT", async () => {
  console.error("[tool-proxy] Shutting down...");
  await backendPool.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("[tool-proxy] Shutting down...");
  await backendPool.close();
  process.exit(0);
});

runServer().catch((error) => {
  console.error("[tool-proxy] Fatal error:", error);
  process.exit(1);
});
