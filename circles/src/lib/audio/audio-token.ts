// Peerify: short-lived signed tokens that authorize streaming a single track's
// MP3 derivative. The storage key is embedded INSIDE the signed token (never in a
// plain query string), so object keys stay non-enumerable and the URL expires.

import { SignJWT, jwtVerify } from "jose";
import { JWT_SECRET } from "@/lib/auth/jwt";

const AUDIENCE = "peerify-audio";
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

const getSecretBytes = (): Uint8Array => {
    if (!JWT_SECRET) {
        throw new Error("Missing JWT secret: set CIRCLES_JWT_SECRET (or JWT_SECRET).");
    }
    return new TextEncoder().encode(JWT_SECRET);
};

export type AudioTokenPayload = {
    trackId: string;
    previewKey: string;
};

export const signAudioToken = async (
    payload: AudioTokenPayload,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> => {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ trackId: payload.trackId, previewKey: payload.previewKey })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ttlSeconds)
        .sign(getSecretBytes());
};

// Returns the payload if the token is valid + unexpired, otherwise null.
export const verifyAudioToken = async (token: string): Promise<AudioTokenPayload | null> => {
    try {
        const { payload } = await jwtVerify(token, getSecretBytes(), { audience: AUDIENCE });
        const trackId = payload.trackId as string | undefined;
        const previewKey = payload.previewKey as string | undefined;
        if (!trackId || !previewKey) return null;
        return { trackId, previewKey };
    } catch {
        return null;
    }
};
