// acting-identity.ts - server-side resolution of "which persona is this account acting as"
//
// Mirrors src/lib/utils/acting-identity.ts's client-side derivation (the profile
// switcher's own "Current" logic: your own personal profile, or one of your
// admin-managed artist/venue identities) but never trusts the client's claim —
// independently re-verifies membership + managed-identity status before honoring it.
import { Circle } from "@/models/models";
import { getCircleById, getCircleByDid } from "./circle";
import { getMember } from "./member";
import { isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";

export type ActingAuthor = {
    authorDid: string;
    actingCircle?: Circle;
};

export const resolveActingAuthor = async (userDid: string, postAsCircleId?: string): Promise<ActingAuthor> => {
    if (!postAsCircleId) {
        return { authorDid: userDid };
    }

    const actingCircle = await getCircleById(postAsCircleId);
    if (!actingCircle || !actingCircle.did) {
        return { authorDid: userDid };
    }

    // Acting "as yourself" — your own personal circle's did is your own did.
    if (actingCircle.did === userDid) {
        return { authorDid: userDid, actingCircle };
    }

    // Acting as a managed identity — only valid if you administer it.
    const membership = await getMember(userDid, postAsCircleId);
    const isAdmin = membership?.userGroups?.includes("admins") ?? false;
    if (isAdmin && isPeerifyManagedIdentity(actingCircle)) {
        return { authorDid: actingCircle.did, actingCircle };
    }

    // Unverifiable/invalid claim — fall back to the account's own identity rather than error out.
    return { authorDid: userDid };
};

// Reverse of resolveActingAuthor's admin check: given content already attributed to
// authorDid, does userDid have the same standing to act on it (edit/etc.) as it did to
// create it — either by being that author directly, or by administering the
// managed-identity circle that authorDid belongs to.
export const canActAsAuthor = async (userDid: string, authorDid: string): Promise<boolean> => {
    if (userDid === authorDid) {
        return true;
    }

    const authorCircle = await getCircleByDid(authorDid);
    if (!authorCircle || !authorCircle._id || !isPeerifyManagedIdentity(authorCircle)) {
        return false;
    }

    const membership = await getMember(userDid, authorCircle._id);
    return membership?.userGroups?.includes("admins") ?? false;
};
