import { describe, expect, test } from "bun:test";
import type { Circle } from "@/models/models";
import { defaultUserGroups } from "./data/constants";
import { safeModifyMemberUserGroups } from "./utils";

// Role changes go through safeModifyMemberUserGroups (updateUserGroupsAction, and the role offer in
// members/actions.ts). Lower accessLevel = more power: admins 100, moderators 200, crew 250,
// members 300. Before the 2026-11-14 fix, `get(h) ?? 0 >= accessLevel` parsed as
// `get(h) ?? (0 >= accessLevel)`, so every group was permissible and a moderator could grant admins.

const circle = { _id: "circle-1", handle: "artist", userGroups: defaultUserGroups } as unknown as Circle;

const ADMIN = 100;
const MODERATOR = 200;

// Defaults: admins hold edit_same_level_user_groups, moderators don't (lib/data/constants.ts).
const asModerator = (existing: string[], submitted: string[]) =>
    safeModifyMemberUserGroups(existing, submitted, circle, MODERATOR, false);
const asAdmin = (existing: string[], submitted: string[]) =>
    safeModifyMemberUserGroups(existing, submitted, circle, ADMIN, true);

describe("safeModifyMemberUserGroups: a moderator can't grant admin", () => {
    test("drops admins when a moderator adds it to a member", () => {
        expect(asModerator(["members"], ["admins", "members"])).toEqual(["members"]);
    });

    test("drops moderators too (same level, without edit_same_level_user_groups)", () => {
        expect(asModerator(["members"], ["moderators", "members"])).toEqual(["members"]);
    });

    test("can't take admins or moderators away either", () => {
        expect(asModerator(["admins", "members"], ["members"])).toEqual(["admins", "members"]);
        expect(asModerator(["moderators", "members"], ["members"])).toEqual(["moderators", "members"]);
    });

    test("a moderator with edit_same_level_user_groups still can't reach admins", () => {
        expect(
            safeModifyMemberUserGroups(["members"], ["admins", "moderators", "members"], circle, MODERATOR, true),
        ).toEqual(["moderators", "members"]);
    });
});

describe("safeModifyMemberUserGroups: what a moderator may still do", () => {
    test("adds crew and members", () => {
        expect(asModerator([], ["crew", "members"])).toEqual(["crew", "members"]);
    });

    test("removes crew from a member", () => {
        expect(asModerator(["crew", "members"], ["members"])).toEqual(["members"]);
    });
});

describe("safeModifyMemberUserGroups: admins", () => {
    test("an admin can grant admins and moderators", () => {
        expect(asAdmin(["members"], ["admins", "moderators", "members"])).toEqual(["admins", "moderators", "members"]);
    });

    test("an admin can remove admins", () => {
        expect(asAdmin(["admins", "members"], ["members"])).toEqual(["members"]);
    });

    test("an admin without edit_same_level_user_groups can grant moderators but not admins", () => {
        expect(safeModifyMemberUserGroups(["members"], ["admins", "moderators"], circle, ADMIN, false)).toEqual([
            "moderators",
        ]);
    });
});

describe("safeModifyMemberUserGroups: edge cases", () => {
    test("never grants a group the circle doesn't define", () => {
        expect(asAdmin([], ["superadmins", "members"])).toEqual(["members"]);
    });

    test("treats a group without an access level as the most powerful", () => {
        const odd = {
            ...circle,
            userGroups: [...defaultUserGroups, { handle: "legacy", name: "Legacy", accessLevel: undefined }],
        } as unknown as Circle;
        expect(safeModifyMemberUserGroups([], ["legacy", "members"], odd, MODERATOR, false)).toEqual(["members"]);
    });

    test("a non-member (maxAccessLevel) can't grant anything", () => {
        expect(safeModifyMemberUserGroups([], ["admins", "members"], circle, 9999999, false)).toEqual([]);
    });
});
