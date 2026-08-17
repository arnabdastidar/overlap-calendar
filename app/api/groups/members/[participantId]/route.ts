import { removeGroupMember } from "../../../../../lib/server-data";

export async function DELETE(request: Request, { params }: { params: Promise<{ participantId: string }> }) {
  try {
    const { participantId } = await params;
    await removeGroupMember(request, participantId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not remove that person." }, { status: 400 });
  }
}
