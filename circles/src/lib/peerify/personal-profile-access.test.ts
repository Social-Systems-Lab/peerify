import { describe, expect, test } from "bun:test";
import { getsLimitedPersonalProfile, isPersonalProfile, toLimitedPersonalProfile } from "./personal-profile-access";

describe("personal profile access (stopgap)", () => {
    test("only circleType user is a personal profile", () => {
        expect(isPersonalProfile({ circleType: "user" })).toBe(true);
        expect(isPersonalProfile({ circleType: "circle" })).toBe(false);
        expect(isPersonalProfile(null)).toBe(false);
    });

    test("signed-out visitors get the limited version of a personal profile, nobody else yet", () => {
        expect(getsLimitedPersonalProfile({ circleType: "user" }, undefined)).toBe(true);
        expect(getsLimitedPersonalProfile({ circleType: "user" }, "did:test:someone")).toBe(false);
        expect(getsLimitedPersonalProfile({ circleType: "circle" }, undefined)).toBe(false);
    });

    test("the limited version is name, handle and picture, and nothing else", () => {
        const circle = {
            handle: "person",
            name: "A Person",
            picture: { url: "https://cdn.example/face.png", fileName: "face.png" },
            description: "private",
            members: 9,
        } as any;
        expect(toLimitedPersonalProfile(circle)).toEqual({
            handle: "person",
            name: "A Person",
            pictureUrl: "https://cdn.example/face.png",
        });
        expect(toLimitedPersonalProfile({ handle: "nopic" } as any)).toEqual({ handle: "nopic" });
    });
});
