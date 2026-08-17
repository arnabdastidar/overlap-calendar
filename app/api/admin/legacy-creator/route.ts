import { maintainLegacyCreator } from "../../../../lib/server-data";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { group?: string; email?: string; mergeDisplayName?: string };
    return Response.json(await maintainLegacyCreator(request, {
      group: body.group ?? "", email: body.email ?? "", mergeDisplayName: body.mergeDisplayName,
    }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Maintenance failed." }, { status: 403 });
  }
}
