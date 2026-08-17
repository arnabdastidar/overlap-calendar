import { updateGroup } from "../../../../lib/server-data";

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { name?: string; password?: string };
    return Response.json({ ok: true, ...(await updateGroup(request, body)) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the group." }, { status: 400 });
  }
}
