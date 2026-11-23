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

// A list entry (search results, pickers, mentions, likers) for a personal profile the viewer gets
// the limited version of: name, handle and picture, plus what a list needs to link to the profile
// and open its preview (_id, did, circleType). A new object, so nothing else can ride along.
export type LimitedPersonalListItem = {
    _id?: string;
    did?: string;
    circleType: "user";
    handle?: string;
    name?: string;
    picture?: { url: string };
};

export const toLimitedPersonalListItem = (
    circle: Pick<Circle, "_id" | "did" | "handle" | "name" | "picture">,
): LimitedPersonalListItem => {
    const limited: LimitedPersonalListItem = { circleType: "user" };
    if (circle._id !== undefined && circle._id !== null) limited._id = String(circle._id);
    if (typeof circle.did === "string" && circle.did) limited.did = circle.did;
    if (typeof circle.handle === "string" && circle.handle) limited.handle = circle.handle;
    if (typeof circle.name === "string" && circle.name) limited.name = circle.name;
    const pictureUrl = typeof circle.picture === "string" ? circle.picture : circle.picture?.url;
    if (typeof pictureUrl === "string" && pictureUrl) limited.picture = { url: pictureUrl };
    return limited;
};
