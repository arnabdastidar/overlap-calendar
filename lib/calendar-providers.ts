import { appEnv } from "./server-data";
import { decryptSecret, encryptSecret } from "./crypto";

type OAuthProvider = "google" | "microsoft";
type BusyInterval = { start: string; end: string };

export function providerReady(provider: OAuthProvider) {
  const configured = provider === "google"
    ? appEnv.GOOGLE_CLIENT_ID && appEnv.GOOGLE_CLIENT_SECRET
    : appEnv.MICROSOFT_CLIENT_ID && appEnv.MICROSOFT_CLIENT_SECRET;
  return Boolean(configured && appEnv.TOKEN_ENCRYPTION_KEY);
}

export function demoCalendarsEnabled() {
  return appEnv.ENABLE_DEMO_CALENDARS?.toLowerCase() === "true";
}

export function authorizationUrl(provider: OAuthProvider, state: string, redirectUri: string) {
  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: appEnv.GOOGLE_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.freebusy", access_type: "offline",
      prompt: "consent", state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  const params = new URLSearchParams({
    client_id: appEnv.MICROSOFT_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code",
    response_mode: "query", scope: "offline_access Calendars.Read", state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

async function tokenRequest(url: string, values: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const data = await response.json() as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? "The calendar provider rejected the connection.");
  return data;
}

export async function exchangeCode(provider: OAuthProvider, code: string, redirectUri: string) {
  const data = provider === "google"
    ? await tokenRequest("https://oauth2.googleapis.com/token", {
        code, redirect_uri: redirectUri, grant_type: "authorization_code",
        client_id: appEnv.GOOGLE_CLIENT_ID ?? "", client_secret: appEnv.GOOGLE_CLIENT_SECRET ?? "",
      })
    : await tokenRequest("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        code, redirect_uri: redirectUri, grant_type: "authorization_code",
        client_id: appEnv.MICROSOFT_CLIENT_ID ?? "", client_secret: appEnv.MICROSOFT_CLIENT_SECRET ?? "",
        scope: "offline_access Calendars.Read",
      });
  if (!data.refresh_token || !appEnv.TOKEN_ENCRYPTION_KEY) throw new Error("The provider did not return a reusable calendar connection.");
  return encryptSecret(data.refresh_token, appEnv.TOKEN_ENCRYPTION_KEY);
}

async function accessToken(provider: OAuthProvider, encryptedRefreshToken: string) {
  if (!appEnv.TOKEN_ENCRYPTION_KEY) throw new Error("Calendar token encryption is not configured.");
  const refreshToken = await decryptSecret(encryptedRefreshToken, appEnv.TOKEN_ENCRYPTION_KEY);
  const data = provider === "google"
    ? await tokenRequest("https://oauth2.googleapis.com/token", {
        refresh_token: refreshToken, grant_type: "refresh_token",
        client_id: appEnv.GOOGLE_CLIENT_ID ?? "", client_secret: appEnv.GOOGLE_CLIENT_SECRET ?? "",
      })
    : await tokenRequest("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        refresh_token: refreshToken, grant_type: "refresh_token",
        client_id: appEnv.MICROSOFT_CLIENT_ID ?? "", client_secret: appEnv.MICROSOFT_CLIENT_SECRET ?? "",
        scope: "offline_access Calendars.Read",
      });
  return {
    value: data.access_token as string,
    rotatedRefreshToken: data.refresh_token ? await encryptSecret(data.refresh_token, appEnv.TOKEN_ENCRYPTION_KEY) : null,
  };
}

export async function readBusyTimes(provider: OAuthProvider, encryptedRefreshToken: string, start: string, end: string, onRefreshToken?: (encryptedRefreshToken: string) => Promise<void>): Promise<BusyInterval[]> {
  const token = await accessToken(provider, encryptedRefreshToken);
  if (token.rotatedRefreshToken && onRefreshToken) await onRefreshToken(token.rotatedRefreshToken);
  if (provider === "google") {
    const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST", headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: start, timeMax: end, items: [{ id: "primary" }] }),
    });
    const data = await response.json() as { calendars?: Record<string, { busy?: BusyInterval[] }>; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? "Google Calendar could not be read.");
    return data.calendars?.primary?.busy ?? [];
  }

  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", start);
  url.searchParams.set("endDateTime", end);
  url.searchParams.set("$select", "start,end,showAs");
  url.searchParams.set("$top", "1000");
  const busy: BusyInterval[] = [];
  let nextUrl: string | null = url.toString();
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: { authorization: `Bearer ${token.value}`, prefer: 'outlook.timezone="UTC"' } });
    const data = await response.json() as {
      value?: Array<{ start: { dateTime: string }; end: { dateTime: string }; showAs?: string }>;
      error?: { message?: string };
      "@odata.nextLink"?: string;
    };
    if (!response.ok) throw new Error(data.error?.message ?? "Microsoft Calendar could not be read.");
    busy.push(...(data.value ?? []).filter((event) => event.showAs !== "free").map((event) => ({
      start: event.start.dateTime.endsWith("Z") ? event.start.dateTime : `${event.start.dateTime}Z`,
      end: event.end.dateTime.endsWith("Z") ? event.end.dateTime : `${event.end.dateTime}Z`,
    })));
    nextUrl = data["@odata.nextLink"] ?? null;
  }
  return busy;
}
