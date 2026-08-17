import { joinGroup, sessionCookie } from "../../../../lib/server-data";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { group?: string; password?: string; displayName?: string; email?: string; challenge?: string; code?: string };
    const result = await joinGroup({
      group: body.group ?? "", password: body.password ?? "", displayName: body.displayName ?? "",
      email: body.email ?? "", challenge: body.challenge ?? "", code: body.code ?? "",
    });
    return new Response(JSON.stringify({ slug: result.slug }), {
      headers: { "content-type": "application/json", "set-cookie": sessionCookie(request, result.token) },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not join the group." }, { status: 400 });
  }
}
