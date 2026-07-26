import assert from "node:assert/strict";
import { getParticipationBlockReason, getParticipationState, shouldShowParticipationBanner } from "./participation-readiness";

const readyVerifiedUser = {
    isAdmin: false,
    isVerified: true,
    verificationStatus: "verified" as const,
    circleType: "user" as const,
    picture: { url: "https://cdn.example.com/custom.png" },
    content: "About me",
};

const readyByStatusOnly = {
    isVerified: false,
    verificationStatus: "verified" as const,
    circleType: "user" as const,
    picture: { url: "https://cdn.example.com/custom.png" },
    content: "About me",
};

const adminNotVerified = {
    isAdmin: true,
    isVerified: false,
    verificationStatus: "unverified" as const,
    circleType: "user" as const,
    picture: { url: "/images/default-picture.png" },
    content: "",
};

const ordinaryUnverifiedUser = {
    isAdmin: false,
    isVerified: false,
    verificationStatus: "unverified" as const,
    circleType: "user" as const,
    picture: { url: "/images/default-picture.png" },
    content: "",
};

// Profile is fully complete (picture + About) but the isVerified/verificationStatus
// flags haven't caught up yet — the helper must follow the server's flag, not
// re-derive readiness live, so this still blocks.
const readinessCompleteButFlagStale = {
    isAdmin: false,
    isVerified: false,
    verificationStatus: "unverified" as const,
    circleType: "user" as const,
    picture: { url: "https://cdn.example.com/custom.png" },
    content: "About me",
};

const pendingVerificationRequest = {
    isAdmin: false,
    isVerified: false,
    verificationStatus: "pending" as const,
    circleType: "user" as const,
    picture: { url: "/images/default-picture.png" },
    content: "",
};

assert.equal(getParticipationBlockReason(adminNotVerified), null, "admin bypass -> null even when not verified");
assert.equal(getParticipationBlockReason(readyVerifiedUser), null, "isVerified true -> null");
assert.equal(getParticipationBlockReason(readyByStatusOnly), null, "verificationStatus verified -> null");
assert.equal(
    getParticipationBlockReason(ordinaryUnverifiedUser),
    "profile_incomplete",
    "not admin, not verified -> profile_incomplete",
);
assert.equal(
    getParticipationBlockReason(readinessCompleteButFlagStale),
    "profile_incomplete",
    "mirrors the server's isVerified flag, not a live readiness recomputation",
);
assert.equal(
    getParticipationBlockReason(pendingVerificationRequest),
    "profile_incomplete",
    "a pending verification request is not yet verified -> profile_incomplete",
);
assert.equal(getParticipationBlockReason(null), "profile_incomplete", "null user fails safe -> profile_incomplete");
assert.equal(
    getParticipationBlockReason(undefined),
    "profile_incomplete",
    "undefined user fails safe -> profile_incomplete",
);
assert.equal(
    getParticipationBlockReason({}),
    "profile_incomplete",
    "empty/inconsistent state fails safe -> profile_incomplete",
);

// Precedence is deterministic: the bypass check always wins over the readiness
// check regardless of how incomplete the profile is.
assert.equal(
    getParticipationBlockReason({ ...ordinaryUnverifiedUser, isAdmin: true }),
    null,
    "admin bypass takes precedence over an incomplete profile",
);

const readyState = getParticipationState(readyVerifiedUser);
assert.equal(readyState.canParticipate, true, "ready state: canParticipate true");
assert.equal(readyState.blockReason, null, "ready state: blockReason null");
assert.equal(readyState.readiness.isReady, true, "ready state: readiness.isReady true");

const blockedState = getParticipationState(ordinaryUnverifiedUser);
assert.equal(blockedState.canParticipate, false, "blocked state: canParticipate false");
assert.equal(blockedState.blockReason, "profile_incomplete", "blocked state: blockReason profile_incomplete");
assert.equal(blockedState.readiness.isReady, false, "blocked state: readiness.isReady false");

// --- shouldShowParticipationBanner: viewer-owner/admin gate + non-null reason ---
assert.equal(
    shouldShowParticipationBanner(ordinaryUnverifiedUser, true),
    true,
    "incomplete profile + viewer is owner/admin -> banner shows",
);
assert.equal(
    shouldShowParticipationBanner(ordinaryUnverifiedUser, false),
    false,
    "incomplete profile but viewer is NOT owner/admin (e.g. a visitor/follower) -> banner hidden",
);
assert.equal(
    shouldShowParticipationBanner(readyVerifiedUser, true),
    false,
    "profile already complete, even for the owner/admin -> banner hidden",
);
assert.equal(
    shouldShowParticipationBanner(readyVerifiedUser, false),
    false,
    "profile complete and viewer not owner/admin -> banner hidden",
);

console.log("participation-readiness tests passed");
