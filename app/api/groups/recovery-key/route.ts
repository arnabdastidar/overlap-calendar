import { rotateRecoveryKey } from "../../../../lib/server-data";

export async function POST(request: Request) {
  try {
    return Response.json({ adminKey: await rotateRecoveryKey(request) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not generate a recovery key." }, { status: 400 });
  }
}
