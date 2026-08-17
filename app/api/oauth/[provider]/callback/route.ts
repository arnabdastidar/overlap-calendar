import { exchangeCode } from "../../../../../lib/calendar-providers";
import { consumeOAuthState, upsertConnection } from "../../../../../lib/server-data";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const origin = new URL(request.url).origin;
  try {
    const { provider: rawProvider } = await params;
    if (rawProvider !== "google" && rawProvider !== "microsoft") throw new Error("Unknown calendar provider.");
    const provider = rawProvider as "google" | "microsoft";
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateToken = url.searchParams.get("state");
    if (!code || !stateToken) throw new Error("The calendar provider did not complete the connection.");
    const state = await consumeOAuthState(stateToken, provider);
    const encryptedRefreshToken = await exchangeCode(provider, code, state.redirectUri);
    await upsertConnection({
      participantId: state.participantId, provider, encryptedRefreshToken,
      accountRef: `oauth:${state.participantId}:${provider}`,
      displayName: provider === "google" ? "Google Calendar" : "Microsoft Outlook",
    });
    return Response.redirect(`${origin}/?group=${encodeURIComponent(state.slug)}&connected=${provider}`);
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Calendar connection failed.");
    return Response.redirect(`${origin}/?calendar_error=${message}`);
  }
}
