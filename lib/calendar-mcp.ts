import { appEnv } from "./server-data";

type McpResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

async function readMcpResponse(response: Response) {
  const body = await response.text();
  if (!response.ok) throw new Error(`Calendar MCP returned ${response.status}.`);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = body.split("\n").filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]").at(-1);
    return data ? JSON.parse(data) : null;
  }
  return body ? JSON.parse(body) : null;
}

export async function findTimesWithMcp(accountIds: string[], duration: number, startDate: string, endDate: string) {
  if (!appEnv.CALENDAR_MCP_URL) throw new Error("Calendar MCP is not configured.");
  const endpoint = new URL("mcp", appEnv.CALENDAR_MCP_URL.endsWith("/") ? appEnv.CALENDAR_MCP_URL : `${appEnv.CALENDAR_MCP_URL}/`).toString();
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (appEnv.CALENDAR_MCP_API_KEY) headers.authorization = `Bearer ${appEnv.CALENDAR_MCP_API_KEY}`;
  const initializeResponse = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "overlap", version: "0.1.0" },
    },
  }) });
  await readMcpResponse(initializeResponse);
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const toolResponse = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_available_times", arguments: {
      accountIds, duration, startDate, endDate, workingHoursOnly: true,
    } },
  }) });
  const envelope = await readMcpResponse(toolResponse) as { result?: McpResult; error?: { message?: string } };
  if (envelope?.error) throw new Error(envelope.error.message ?? "Calendar MCP call failed.");
  const text = envelope?.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return [];
  const parsed = JSON.parse(text) as { availableSlots?: Array<{ start: string; end: string }> };
  return parsed.availableSlots ?? [];
}
