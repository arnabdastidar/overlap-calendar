import { demoCalendarsEnabled, providerReady } from "../../../../lib/calendar-providers";
import { appEnv } from "../../../../lib/server-data";

export async function GET() {
  return Response.json({
    google: providerReady("google"),
    microsoft: providerReady("microsoft"),
    mcp: Boolean(appEnv.CALENDAR_MCP_URL),
    demo: demoCalendarsEnabled(),
  });
}
