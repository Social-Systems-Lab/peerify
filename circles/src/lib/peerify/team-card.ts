// The Team card on a circle's About page (Tim's decision 2026-11-07). Client-safe (no db).
// - Who appears: the circle's admins and moderators who switched it on themselves (Member
//   teamCardVisible, off by default). Name, picture, handle and role only: no email, phone,
//   location or DID.
// - The note: one short plain-text note an admin posts at the top; a new note replaces the old one.
// - Nothing to show (no one opted in, no note): the card isn't rendered, except for the circle's own
//   admins and moderators, who need it to opt in.

export const TEAM_NOTE_MAX_LENGTH = 280;

export const TEAM_NOTE_EDITOR_HINT =
    "Visible to everyone, also logged out. Don't share addresses or phone numbers here.";

export type TeamCardRole = "Admin" | "Moderator";

export type TeamCardMember = {
    name: string;
    handle: string;
    pictureUrl?: string;
    role: TeamCardRole;
};

export type TeamCardNote = {
    text: string;
    updatedAt: string; // ISO date
    authorName: string;
    authorHandle?: string;
};

export type TeamCardData = {
    members: TeamCardMember[];
    note: TeamCardNote | null;
};

export const teamCardRoleOf = (userGroups: string[] | undefined): TeamCardRole | null => {
    if (userGroups?.includes("admins")) return "Admin";
    if (userGroups?.includes("moderators")) return "Moderator";
    return null;
};

// Plain text, trimmed, 1..280 characters. Returns the text to store or an error message.
export const validateTeamNote = (input: unknown): { text: string } | { error: string } => {
    if (typeof input !== "string") return { error: "The note must be text." };
    const text = input.replace(/\r\n?/g, "\n").trim();
    if (!text) return { error: "The note is empty." };
    if (text.length > TEAM_NOTE_MAX_LENGTH) {
        return { error: `The note can be at most ${TEAM_NOTE_MAX_LENGTH} characters.` };
    }
    return { text };
};
