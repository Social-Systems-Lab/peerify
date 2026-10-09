import { NextResponse } from "next/server";
import { ServerSettingsCollection } from "@/lib/data/db";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3000;

// A real read, not a ping: ping succeeds without authentication, a find doesn't once
// mongod enforces auth. Wrong credentials fail the handshake even while auth is off.
// Returns only a status code: no body, no error details.
export async function GET() {
    let ok = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            ServerSettingsCollection.findOne({}, { projection: { _id: 1 }, maxTimeMS: TIMEOUT_MS }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
            }),
        ]);
        ok = true;
    } catch (error) {
        console.error("health: database read failed:", (error as Error)?.name);
    } finally {
        clearTimeout(timer);
    }
    return new NextResponse(null, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
