import { expiredSessionCookie, leaveGroup } from "../../../../lib/server-data";

export async function POST(request: Request) {
  await leaveGroup(request);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": expiredSessionCookie() },
  });
}
