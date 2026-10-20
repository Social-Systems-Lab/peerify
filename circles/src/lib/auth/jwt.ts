// jwt.ts
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME } from "./cookie";

export const JWT_SECRET = process.env.CIRCLES_JWT_SECRET || process.env.JWT_SECRET;

const getJwtSecretBytes = (): Uint8Array => {
    if (!JWT_SECRET) {
        throw new Error("Missing JWT secret: set CIRCLES_JWT_SECRET (or JWT_SECRET for local development).");
    }
    return new TextEncoder().encode(JWT_SECRET);
};

// Session tokens (generateUserToken) carry a non-empty userDid and no audience. Other tokens signed
// with the same key, such as audio tokens (aud "peerify-audio", no userDid), are not sessions:
// reject them here so no caller can mistake one for a login.
export const verifyUserToken = async (token: string): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    if (typeof payload.userDid !== "string" || payload.userDid.length === 0 || payload.aud !== undefined) {
        throw new Error("Not a session token");
    }
    return payload;
};

const shouldUseSecureCookie = (): boolean => {
    if (process.env.CIRCLES_COOKIE_SECURE !== undefined) {
        return process.env.CIRCLES_COOKIE_SECURE === "true";
    }

    return process.env.NODE_ENV === "production";
};

export const createSession = async (token: string) => {
    // create a cookie-based session
    (await cookies()).set(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: shouldUseSecureCookie(),
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 90, // 90 days
        path: "/",
    });
};

export const generateUserToken = async (did: string): Promise<string> => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 24 * 60 * 60 * 90; // 90 days

    return new SignJWT({ userDid: did })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setExpirationTime(exp)
        .setIssuedAt(iat)
        .setNotBefore(iat)
        .sign(getJwtSecretBytes());
};
