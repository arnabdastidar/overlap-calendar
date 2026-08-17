import { requestEmailVerification } from "../../../lib/server-data";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { purpose?: string; email?: string; group?: string; password?: string };
    if (body.purpose !== "create" && body.purpose !== "join" && body.purpose !== "creator") {
      return Response.json({ error: "Choose a valid verification flow." }, { status: 400 });
    }
    const result = await requestEmailVerification(request, {
      purpose: body.purpose, email: body.email ?? "", group: body.group, password: body.password,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send a verification code." }, { status: 400 });
  }
}
