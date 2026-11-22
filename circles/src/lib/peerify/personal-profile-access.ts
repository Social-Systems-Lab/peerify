// Personal profiles (circleType "user") and their limited version (Tim, 2026-11-22). Artist, band
// and venue circles are not personal profiles and keep their public behaviour. Client-safe: the
// rule itself needs the database and lives in lib/data/personal-profile-access.ts.
//
// The limited version is name, handle and picture only. Everyone except the owner, superadmins and
// the owner's accepted connections gets it, signed in or not; following doesn't count, and the
// search and map settings play no part.

import type { Circle } from "@/models/models";

export const isPersonalProfile = (circle: Pick<Circle, "circleType"> | null | undefined): boolean =>
    circle?.circleType === "user";

export type LimitedPersonalProfile = {
    handle: string;
    name?: string;
    pictureUrl?: string;
};

// Builds a new object from the three allowed fields only, so nothing else can ride along.
export const toLimitedPersonalProfile = (
    circle: Pick<Circle, "handle" | "name" | "picture">,
): LimitedPersonalProfile => {
    const limited: LimitedPersonalProfile = { handle: String(circle.handle ?? "") };
    if (typeof circle.name === "string" && circle.name) limited.name = circle.name;
    const pictureUrl = typeof circle.picture === "string" ? circle.picture : circle.picture?.url;
    if (typeof pictureUrl === "string" && pictureUrl) limited.pictureUrl = pictureUrl;
    return limited;
};
