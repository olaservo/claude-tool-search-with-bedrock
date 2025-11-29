// Tool definition matching Anthropic's schema
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  defer_loading?: boolean;
}

// Tool search tool types (Bedrock uses shorter names without date suffixes)
export type ToolSearchType = "tool_search_tool_regex";

// Request to our MCP tool
export interface ToolSearchRequest {
  query: string;                    // User's natural language query
  tools: ToolDefinition[];          // Tools to search through
  search_type?: ToolSearchType;     // Default: bm25
  max_results?: number;             // Default: 5
}

// Anthropic Messages API types for Bedrock
export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "tool_reference" | "server_tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
}

// Bedrock response types
export interface BedrockResponse {
  id: string;
  type: string;
  role: string;
  content: ContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Tool reference from server_tool_use response
export interface ToolReference {
  type: "tool_reference";
  name: string;
}
