import { updateGroup } from "../../../../lib/server-data";

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { name?: string; password?: string };
    await updateGroup(request, body);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the group." }, { status: 400 });
  }
}
