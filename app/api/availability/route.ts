import { findGroupAvailability } from "../../../lib/availability";
import { currentContext } from "../../../lib/server-data";

export async function GET(request: Request) {
  try {
    const context = await currentContext(request);
    if (!context) return Response.json({ error: "Join a group first." }, { status: 401 });
    const url = new URL(request.url);
    const duration = Number(url.searchParams.get("duration") ?? 60);
    const days = Number(url.searchParams.get("days") ?? 30);
    const timezone = url.searchParams.get("timezone") ?? "UTC";
    if (!Number.isInteger(duration) || duration < 30 || duration > 300 || duration % 30 !== 0) {
      return Response.json({ error: "Meeting length must be 30 minutes to 5 hours." }, { status: 400 });
    }
    if (![30, 60, 90, 180].includes(days)) return Response.json({ error: "Choose 30, 60, 90, or 180 days." }, { status: 400 });
    return Response.json(await findGroupAvailability(context.groupId, duration, days, timezone));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not calculate availability." }, { status: 500 });
  }
}
