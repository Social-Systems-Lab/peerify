import { ObjectId } from "mongodb";
import { Circles, Members } from "./db";
import { teamCardRoleOf, type TeamCardData, type TeamCardMember } from "@/lib/peerify/team-card";

/**
 * The Team card's public content (see lib/peerify/team-card.ts): the circle's admins and moderators
 * who switched teamCardVisible on, with name, picture, handle and role only, and the admins' note.
 * Personal profiles have no Team card.
 */
export const getTeamCard = async (circleId: string): Promise<TeamCardData> => {
    if (!ObjectId.isValid(circleId)) return { members: [], note: null };
    const circle = await Circles.findOne(
        { _id: new ObjectId(circleId) },
        { projection: { circleType: 1, teamNote: 1 } },
    );
    if (!circle || circle.circleType === "user") return { members: [], note: null };

    const rows = await Members.find(
        { circleId, userGroups: { $in: ["admins", "moderators"] }, teamCardVisible: true },
        { projection: { userDid: 1, userGroups: 1, joinedAt: 1 } },
    ).toArray();
    const optedIn = rows.filter((row) => teamCardRoleOf(row.userGroups));

    const dids = [...optedIn.map((row) => row.userDid), ...(circle.teamNote?.authorDid ? [circle.teamNote.authorDid] : [])];
    const profiles = dids.length
        ? await Circles.find({ did: { $in: dids } }, { projection: { did: 1, name: 1, handle: 1, picture: 1 } }).toArray()
        : [];
    const profileOf = (did: string) => profiles.find((profile) => profile.did === did);

    const members: TeamCardMember[] = [];
    for (const row of optedIn) {
        const profile = profileOf(row.userDid);
        if (!profile?.handle) continue;
        members.push({
            name: profile.name || profile.handle,
            handle: profile.handle,
            ...(profile.picture?.url ? { pictureUrl: profile.picture.url } : {}),
            role: teamCardRoleOf(row.userGroups)!,
        });
    }
    // Admins first, then moderators, each by name.
    members.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "Admin" ? -1 : 1));

    const stored = circle.teamNote;
    const author = stored?.authorDid ? profileOf(stored.authorDid) : undefined;
    const note =
        stored?.text && stored.updatedAt
            ? {
                  text: stored.text,
                  updatedAt: new Date(stored.updatedAt).toISOString(),
                  authorName: author?.name || author?.handle || "An admin",
                  ...(author?.handle ? { authorHandle: author.handle } : {}),
              }
            : null;
    return { members, note };
};

export const setTeamCardVisibility = async (userDid: string, circleId: string, visible: boolean): Promise<void> => {
    await Members.updateOne({ userDid, circleId }, { $set: { teamCardVisible: visible } });
};

export const setTeamNote = async (circleId: string, authorDid: string, text: string): Promise<void> => {
    await Circles.updateOne(
        { _id: new ObjectId(circleId) },
        { $set: { teamNote: { text, authorDid, updatedAt: new Date() } } },
    );
};

export const removeTeamNote = async (circleId: string): Promise<void> => {
    await Circles.updateOne({ _id: new ObjectId(circleId) }, { $unset: { teamNote: "" } });
};
