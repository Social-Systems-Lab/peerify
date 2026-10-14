import { NextResponse } from "next/server";
import { createAltchaChallenge } from "@/lib/auth/altcha";

export const dynamic = "force-dynamic";

export async function GET() {
    const hmacKey = process.env.ALTCHA_HMAC_KEY;
    if (!hmacKey) {
        return NextResponse.json({ error: "ALTCHA not configured" }, { status: 500 });
    }
    const challenge = await createAltchaChallenge(hmacKey);
    // Each challenge carries its own issue time and can be spent once; never serve one from a cache.
    return NextResponse.json(challenge, { headers: { "Cache-Control": "no-store" } });
}
