import { assignGroupMemberEmail, removeGroupMember, sendGroupMemberReminder } from "../../../../../lib/server-data";

export async function PUT(request: Request, { params }: { params: Promise<{ participantId: string }> }) {
  try {
    const { participantId } = await params;
    const body = await request.json() as { email?: string };
    const email = await assignGroupMemberEmail(request, participantId, body.email ?? "");
    return Response.json({ email });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save that email." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ participantId: string }> }) {
  try {
    const { participantId } = await params;
    await sendGroupMemberReminder(request, participantId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send the reminder." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ participantId: string }> }) {
  try {
    const { participantId } = await params;
    await removeGroupMember(request, participantId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not remove that person." }, { status: 400 });
  }
}
