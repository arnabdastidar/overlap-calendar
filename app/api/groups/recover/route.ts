import { recoverGroup, recoverGroupByEmail, sessionCookie } from "../../../../lib/server-data";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      group?: string; adminKey?: string; displayName?: string; email?: string; challenge?: string; code?: string;
    };
    const result = body.challenge && body.email
      ? await recoverGroupByEmail({
          group: body.group ?? "", displayName: body.displayName ?? "", email: body.email,
          challenge: body.challenge, code: body.code ?? "",
        })
      : await recoverGroup({ group: body.group ?? "", adminKey: body.adminKey ?? "", displayName: body.displayName ?? "" });
    return new Response(JSON.stringify({ slug: result.slug }), {
      headers: { "content-type": "application/json", "set-cookie": sessionCookie(request, result.token) },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not restore creator access." }, { status: 400 });
  }
}
