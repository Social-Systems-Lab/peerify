import assert from "node:assert/strict";
import { isOwnerOrCircleAdmin } from "./client-auth";
import type { Circle, UserPrivate } from "@/models/models";

const artistCircle = {
    _id: "circle-1",
    did: "did:circle:artist-1",
    circleType: "circle",
    accessRules: {},
} as unknown as Circle;

const personalProfileCircle = {
    _id: "user-1",
    did: "did:user:owner-1",
    circleType: "user",
    accessRules: {},
} as unknown as Circle;

const ownerViewingOwnProfile = {
    _id: "user-1",
    did: "did:user:owner-1",
    memberships: [],
} as unknown as UserPrivate;

const adminOfArtistCircle = {
    _id: "user-2",
    did: "did:user:admin-2",
    isVerified: false,
    verificationStatus: "unverified",
    memberships: [{ circleId: "circle-1", userGroups: ["admins", "members"] }],
} as unknown as UserPrivate;

const plainFollowerOfArtistCircle = {
    _id: "user-3",
    did: "did:user:follower-3",
    memberships: [{ circleId: "circle-1", userGroups: ["members"] }],
} as unknown as UserPrivate;

const nonMemberVisitor = {
    _id: "user-4",
    did: "did:user:visitor-4",
    memberships: [],
} as unknown as UserPrivate;

assert.equal(
    isOwnerOrCircleAdmin(ownerViewingOwnProfile, personalProfileCircle),
    true,
    "self-check: viewer's did matches the personal profile circle's did",
);
assert.equal(
    isOwnerOrCircleAdmin(adminOfArtistCircle, artistCircle),
    true,
    "admins-group membership grants owner/admin visibility, even when the admin's own profile is unverified",
);
assert.equal(
    isOwnerOrCircleAdmin(plainFollowerOfArtistCircle, artistCircle),
    false,
    "a plain 'members'-group follower is not the circle's owner/admin",
);
assert.equal(
    isOwnerOrCircleAdmin(nonMemberVisitor, artistCircle),
    false,
    "a non-member visitor is not the circle's owner/admin",
);
assert.equal(
    isOwnerOrCircleAdmin(undefined, artistCircle),
    false,
    "no logged-in user fails safe -> not owner/admin",
);

console.log("client-auth (isOwnerOrCircleAdmin) tests passed");
