import { requestEmailVerification, verifyCurrentProfileEmail } from "../../../../lib/server-data";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    return Response.json(await requestEmailVerification(request, { purpose: "profile", email: body.email ?? "" }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send a verification code." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { email?: string; challenge?: string; code?: string };
    return Response.json(await verifyCurrentProfileEmail(request, {
      email: body.email ?? "", challenge: body.challenge ?? "", code: body.code ?? "",
    }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not verify this profile." }, { status: 400 });
  }
}
