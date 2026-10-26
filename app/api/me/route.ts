import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { getUserMeta, hasMasterCv, userFileExists } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Check headers injected by middleware or verify cookie
  let userId = request.headers.get("x-user-id");
  let userName = request.headers.get("x-user-name");

  if (!userId || !userName) {
    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie) {
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      return jsonError("UNAUTHORIZED");
    }

    userId = session.uid;
    userName = session.name;
  }

  const hasCv = await hasMasterCv(userId);
  const hasTailored = await userFileExists(`cv/${userId}/latest.docx`);
  const hasPdf = await userFileExists(`cv/${userId}/latest.pdf`);
  const meta = await getUserMeta(userId);

  console.log(`[api/me] Status for uid="${userId}" (${userName}): masterCv=${hasCv}, tailoredDocx=${hasTailored}, pdf=${hasPdf}`);

  return NextResponse.json({
    ok: true,
    uid: userId,
    name: userName,
    hasCv,
    hasTailored,
    hasPdf,
    meta,
  });
}
