// acting-identity.ts
"use client";

import { useCallback } from "react";
import { useAtom } from "jotai";
import { userAtom, actingIdentityCircleIdAtom } from "@/lib/data/atoms";
import { Circle, UserPrivate } from "@/models/models";
import { isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";

// The account's own artist/venue identities it administers — the same set the
// profile switcher lists as persona choices. An account only ever "acts as"
// one of these or its own personal profile; it never acts as a circle it's
// merely a member/follower of.
export const getManagedIdentities = (user?: UserPrivate): Circle[] =>
    user?.memberships
        ?.filter((membership) => isPeerifyManagedIdentity(membership.circle))
        .filter((membership) => membership.userGroups?.includes("admins"))
        .map((membership) => membership.circle) ?? [];

export const getCircleHandleFromPath = (pathname?: string | null): string | undefined => {
    if (!pathname?.startsWith("/circles/")) return undefined;
    return pathname.split("/").filter(Boolean)[1];
};

// The single source of truth for "who am I acting as right now" — a persistent choice
// (see actingIdentityCircleIdAtom) that holds steady across navigation and survives a
// refresh, until explicitly changed via the switcher's "act as" control. Falls back to
// the account's own personal profile if nothing has been chosen yet, or if the persisted
// choice no longer refers to an identity the account still administers.
export const useActingIdentity = (): Circle | undefined => {
    const [user] = useAtom(userAtom);
    const [actingIdentityCircleId] = useAtom(actingIdentityCircleIdAtom);
    if (!user) return undefined;
    if (!actingIdentityCircleId) return user;
    return getManagedIdentities(user).find((identity) => identity._id === actingIdentityCircleId) ?? user;
};

// Sets the persistent "acting as" choice — pass a managed identity to act as it, or
// the account's own circle (or undefined) to revert to acting as yourself. Doesn't
// validate against canActAsCircle itself; callers should only offer choices the
// switcher already knows are legitimate (the server re-verifies regardless).
export const useSetActingIdentity = () => {
    const [, setActingIdentityCircleId] = useAtom(actingIdentityCircleIdAtom);
    return useCallback(
        (target: Circle | undefined) => {
            setActingIdentityCircleId(target?._id ?? null);
        },
        [setActingIdentityCircleId],
    );
};

// Whether the account could legitimately author content as `targetCircle` — its own
// personal profile, or a managed identity it administers. Used client-side to decide
// whose name/avatar to preview in a composer before submitting; the server
// independently re-verifies this via resolveActingAuthor, never trusting the client.
export const canActAsCircle = (user: UserPrivate | undefined, targetCircle: Circle | undefined | null): boolean => {
    if (!user || !targetCircle) return false;
    if (targetCircle._id === user._id) return true;
    return getManagedIdentities(user).some((identity) => identity._id === targetCircle._id);
};

// Whether the account has the same standing over existing content (e.g. deciding
// whether to show an Edit action) as it would need to have created it as authorDid —
// itself, or a managed identity it administers. Mirrors the server's re-verification
// in canActAsAuthor (src/lib/data/acting-identity.ts) using the membership data already
// present on `user` client-side; the server independently re-checks regardless.
export const canActAsAuthorDid = (user: UserPrivate | undefined, authorDid: string | undefined): boolean => {
    if (!user || !authorDid) return false;
    if (authorDid === user.did) return true;
    return getManagedIdentities(user).some((identity) => identity.did === authorDid);
};
