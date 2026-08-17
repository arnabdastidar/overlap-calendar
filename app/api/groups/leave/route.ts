import { leaveGroup } from "../../../../lib/server-data";

export async function POST(request: Request) {
  try {
    const cookie = await leaveGroup(request);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not leave the group." }, { status: 400 });
  }
}
