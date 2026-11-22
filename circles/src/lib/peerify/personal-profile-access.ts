// Personal profiles (circleType "user") and who gets their limited version (Tim, 2026-11-22).
// Artist, band and venue circles are not personal profiles and keep their public behaviour.
//
// The limited version is name, handle and picture only. Stopgap (this file's first version): a
// signed-out visitor always gets it. The full rule (owner, superadmins and accepted connections
// see everything; following doesn't count) replaces getsLimitedPersonalProfile in the next step.

import type { Circle } from "@/models/models";

export const isPersonalProfile = (circle: Pick<Circle, "circleType"> | null | undefined): boolean =>
    circle?.circleType === "user";

export const getsLimitedPersonalProfile = (
    circle: Pick<Circle, "circleType"> | null | undefined,
    viewerDid: string | null | undefined,
): boolean => isPersonalProfile(circle) && !viewerDid;

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
