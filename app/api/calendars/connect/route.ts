import { authorizationUrl, demoCalendarsEnabled, providerReady } from "../../../../lib/calendar-providers";
import { appEnv, currentContext, saveOAuthState, upsertConnection } from "../../../../lib/server-data";

export async function POST(request: Request) {
  try {
    const context = await currentContext(request);
    if (!context) return Response.json({ error: "Join a group first." }, { status: 401 });
    const body = await request.json() as { provider?: string; accountId?: string };
    if (body.provider === "mcp") {
      if (!appEnv.CALENDAR_MCP_URL) return Response.json({ error: "This deployment has not configured a Calendar MCP server." }, { status: 400 });
      if (!body.accountId?.trim()) return Response.json({ error: "An MCP account ID is required." }, { status: 400 });
      await upsertConnection({ participantId: context.participantId, provider: "mcp", accountRef: body.accountId.trim(), displayName: "Calendar MCP" });
      return Response.json({ connected: true, mode: "mcp" });
    }
    if (body.provider !== "google" && body.provider !== "microsoft") {
      return Response.json({ error: "Choose Google or Microsoft Calendar." }, { status: 400 });
    }
    if (providerReady(body.provider)) {
      const redirectUri = `${new URL(request.url).origin}/api/oauth/${body.provider}/callback`;
      const state = await saveOAuthState(context, body.provider, redirectUri);
      return Response.json({ authorizationUrl: authorizationUrl(body.provider, state, redirectUri), mode: "oauth" });
    }
    if (!demoCalendarsEnabled()) {
      const name = body.provider === "google" ? "Google Calendar" : "Microsoft Outlook";
      return Response.json({ error: `${name} is not configured on this deployment yet.` }, { status: 503 });
    }
    await upsertConnection({
      participantId: context.participantId, provider: body.provider,
      accountRef: `demo:${context.participantId}:${body.provider}`,
      displayName: body.provider === "google" ? "Google Calendar" : "Microsoft Outlook",
    });
    return Response.json({ connected: true, mode: "demo" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not connect the calendar." }, { status: 400 });
  }
}
