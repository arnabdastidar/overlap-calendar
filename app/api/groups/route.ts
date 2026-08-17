import { createGroup, groupSnapshot, sessionCookie } from "../../../lib/server-data";

function errorResponse(error: unknown, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : "Something went wrong." }, { status });
}

export async function GET(request: Request) {
  try {
    const group = await groupSnapshot(request);
    return group ? Response.json({ group }) : errorResponse(new Error("Not in a group."), 401);
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; password?: string; displayName?: string; email?: string; challenge?: string; code?: string };
    const result = await createGroup({
      name: body.name ?? "", password: body.password ?? "", displayName: body.displayName ?? "",
      email: body.email ?? "", challenge: body.challenge ?? "", code: body.code ?? "",
    });
    return new Response(JSON.stringify({ slug: result.slug, adminKey: result.adminKey }), {
      status: 201,
      headers: { "content-type": "application/json", "set-cookie": await sessionCookie(request, result.token) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
