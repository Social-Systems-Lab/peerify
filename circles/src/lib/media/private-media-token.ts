// Short-lived signed links to files in the private bucket (/api/private-media?t=...). The server
// signs one only after it has decided this viewer may see the file (e.g. a verification thread's
// admin or applicant), and the link stops working after its TTL. The storage key travels inside
// the signed token, never as a plain query value, so keys can't be listed or guessed.
//
// Signed with a key derived from JWT_SECRET (Tim, 2026-10-28), not JWT_SECRET itself: a media
// token can never verify as a session, and a session token never verifies here. Rotating
// JWT_SECRET just ends all open links early.

import { createHmac } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { JWT_SECRET } from "@/lib/auth/jwt";

const AUDIENCE = "peerify-private-media";
const KEY_LABEL = "peerify-private-media-v1";

// Verification attachments: 15 minutes (Tim, 2026-10-28).
export const VERIFICATION_MEDIA_TTL_SECONDS = 15 * 60;

// Key prefixes a media token may name. Audio stays on its own route; anything else is refused even
// with a valid signature.
export const PRIVATE_MEDIA_KEY_PREFIXES = ["verification/"] as const;

export const isAllowedPrivateMediaKey = (key: string): boolean =>
    PRIVATE_MEDIA_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) && !key.includes("..");

const getKeyBytes = (): Uint8Array => {
    if (!JWT_SECRET) {
        throw new Error("Missing JWT secret: set CIRCLES_JWT_SECRET (or JWT_SECRET).");
    }
    return new Uint8Array(createHmac("sha256", JWT_SECRET).update(KEY_LABEL).digest());
};

export type PrivateMediaTokenPayload = {
    key: string;
    // Download file name for non-images (Content-Disposition), chosen by the server at upload.
    name?: string;
};

export const signPrivateMediaToken = async (
    payload: PrivateMediaTokenPayload,
    ttlSeconds: number,
): Promise<string> => {
    if (!isAllowedPrivateMediaKey(payload.key)) {
        throw new Error("Refusing to sign a private media token for this key");
    }
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ key: payload.key, ...(payload.name ? { name: payload.name } : {}) })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ttlSeconds)
        .sign(getKeyBytes());
};

// The payload when the token is valid, unexpired and names an allowed key; otherwise null.
export const verifyPrivateMediaToken = async (token: string): Promise<PrivateMediaTokenPayload | null> => {
    try {
        const { payload } = await jwtVerify(token, getKeyBytes(), { audience: AUDIENCE });
        const key = payload.key;
        if (typeof key !== "string" || !isAllowedPrivateMediaKey(key)) return null;
        const name = typeof payload.name === "string" ? payload.name : undefined;
        return { key, name };
    } catch {
        return null;
    }
};

export const privateMediaUrl = async (payload: PrivateMediaTokenPayload, ttlSeconds: number): Promise<string> =>
    `/api/private-media?t=${encodeURIComponent(await signPrivateMediaToken(payload, ttlSeconds))}`;
