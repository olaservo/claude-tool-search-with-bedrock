import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ToolDefinition, ToolSearchType, Message, BedrockResponse } from "./types.js";

// Environment configuration
const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const AWS_PROFILE = process.env.AWS_PROFILE || "claude_code";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "global.anthropic.claude-opus-4-5-20251101-v1:0";

// Initialize BedrockRuntimeClient with aws-okta profile support
const client = new BedrockRuntimeClient({
  region: AWS_REGION,
  ...(AWS_PROFILE && { profile: AWS_PROFILE })
});

/**
 * Invoke Bedrock with tool search enabled
 * Uses the InvokeModel API (not Converse) as required for tool search
 */
export async function invokeWithToolSearch(
  messages: Message[],
  tools: ToolDefinition[],
  searchType: ToolSearchType
): Promise<BedrockResponse> {
  // Mark all tools as deferred - they'll only be loaded when discovered
  const deferredTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    defer_loading: true
  }));

  // Add the tool search tool (non-deferred) at the start
  // Note: name must match the type for tool_search_tool_regex
  const allTools = [
    { type: searchType, name: searchType },
    ...deferredTools
  ];

  const requestBody = {
    anthropic_version: "bedrock-2023-05-31",
    anthropic_beta: ["tool-search-tool-2025-10-19"],
    max_tokens: 4096,
    messages,
    tools: allTools
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody)
  });

  const response = await client.send(command);
  const responseBody = new TextDecoder().decode(response.body);
  return JSON.parse(responseBody) as BedrockResponse;
}

// Extended types for tool search results
interface ToolSearchToolResult {
  type: "tool_search_tool_result";
  tool_use_id: string;
  content: {
    type: "tool_search_tool_search_result";
    tool_references: Array<{
      type: "tool_reference";
      tool_name: string;
    }>;
  };
}

/**
 * Extract tool references from the Bedrock response
 * The response contains tool_search_tool_result blocks with tool_references
 */
export function extractToolReferences(
  response: BedrockResponse,
  maxResults: number = 5
): string[] {
  const toolRefs: string[] = [];

  for (const block of response.content) {
    // Look for tool_search_tool_result blocks
    if ((block as unknown as { type: string }).type === "tool_search_tool_result") {
      const searchResult = block as unknown as ToolSearchToolResult;
      if (searchResult.content?.tool_references) {
        for (const ref of searchResult.content.tool_references) {
          if (ref.tool_name) {
            toolRefs.push(ref.tool_name);
          }
        }
      }
    }
  }

  return toolRefs.slice(0, maxResults);
}
