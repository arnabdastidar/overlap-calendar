import { demoCalendarsEnabled, providerReady, readBusyTimes } from "./calendar-providers";
import { findTimesWithMcp } from "./calendar-mcp";
import { appEnv, groupConnections, updateConnectionRefreshToken } from "./server-data";

type Interval = { start: string; end: string };

function isDemoConnection(connection: { provider: string; accountRef: string }) {
  return (connection.provider === "google" || connection.provider === "microsoft")
    && connection.accountRef.startsWith("demo:");
}

function timezoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)])) as Record<string, number>;
}

function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const seen = timezoneParts(new Date(guess), timezone);
  let offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second) - guess;
  let result = guess - offset;
  const refined = timezoneParts(new Date(result), timezone);
  offset = Date.UTC(refined.year, refined.month - 1, refined.day, refined.hour, refined.minute, refined.second) - result;
  result = guess - offset;
  return result;
}

function demoBusy(connectionId: string, days: number, timezone: string): Interval[] {
  const today = timezoneParts(new Date(), timezone);
  const seed = Array.from(connectionId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const intervals: Interval[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const localDate = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = localDate.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const year = localDate.getUTCFullYear();
    const month = localDate.getUTCMonth() + 1;
    const day = localDate.getUTCDate();
    for (const hour of [10 + (seed % 3), 14 + (seed % 2)]) {
      intervals.push({
        start: new Date(zonedLocalToUtc(year, month, day, hour, 0, timezone)).toISOString(),
        end: new Date(zonedLocalToUtc(year, month, day, hour + 1, 0, timezone)).toISOString(),
      });
    }
  }
  return intervals;
}

function intersects(start: number, end: number, busy: Interval) {
  return start < Date.parse(busy.end) && end > Date.parse(busy.start);
}

export async function findGroupAvailability(groupId: string, duration: number, days: number, timezone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new Error("Choose a valid time zone."); }

  const demoEnabled = demoCalendarsEnabled();
  const connections = (await groupConnections(groupId)).filter((connection) => {
    if (isDemoConnection(connection)) return demoEnabled;
    if (connection.provider === "mcp") return Boolean(appEnv.CALENDAR_MCP_URL);
    return providerReady(connection.provider);
  });
  if (!connections.length) return { slots: [], connectionCount: 0, source: "none" };
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const mcpConnections = connections.filter((connection) => connection.provider === "mcp");
  if (mcpConnections.length === connections.length && appEnv.CALENDAR_MCP_URL) {
    const slots = await findTimesWithMcp(mcpConnections.map((item) => item.accountRef), duration, start.toISOString(), end.toISOString());
    return { slots: slots.slice(0, 40), connectionCount: connections.length, source: "mcp" };
  }
  if (mcpConnections.length) {
    throw new Error("This group mixes direct OAuth and Calendar MCP connections. Use one connection mode for everyone in the group.");
  }

  const busyByConnection = await Promise.all(connections.map(async (connection) => {
    if ((connection.provider === "google" || connection.provider === "microsoft") && connection.encryptedRefreshToken) {
      return readBusyTimes(
        connection.provider,
        connection.encryptedRefreshToken,
        start.toISOString(),
        end.toISOString(),
        (encryptedRefreshToken) => updateConnectionRefreshToken(connection.id, encryptedRefreshToken),
      );
    }
    if (demoEnabled && isDemoConnection(connection)) {
      return demoBusy(connection.id, days, timezone);
    }
    throw new Error(`${connection.displayName} needs to be reconnected before availability can be calculated.`);
  }));
  const busy = busyByConnection.flat();
  const today = timezoneParts(start, timezone);
  const slots: Interval[] = [];
  for (let offset = 0; offset < days && slots.length < 40; offset += 1) {
    const localDate = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if ([0, 6].includes(localDate.getUTCDay())) continue;
    const year = localDate.getUTCFullYear();
    const month = localDate.getUTCMonth() + 1;
    const day = localDate.getUTCDate();
    for (let minutes = 9 * 60; minutes + duration <= 18 * 60 && slots.length < 40; minutes += 30) {
      const startMs = zonedLocalToUtc(year, month, day, Math.floor(minutes / 60), minutes % 60, timezone);
      const endMs = startMs + duration * 60 * 1000;
      if (startMs <= Date.now() || busy.some((interval) => intersects(startMs, endMs, interval))) continue;
      slots.push({ start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() });
    }
  }
  return { slots, connectionCount: connections.length, source: connections.every(isDemoConnection) ? "demo" : "provider" };
}
