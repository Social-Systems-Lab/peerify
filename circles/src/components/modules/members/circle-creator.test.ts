import { describe, expect, test } from "bun:test";
import { canOfferAdminRemoval, isCircleCreator } from "./circle-creator";

const CREATOR = "did:test:creator";
const circle = { createdBy: CREATOR };

describe("isCircleCreator", () => {
    test("matches createdBy only", () => {
        expect(isCircleCreator(circle, CREATOR)).toBe(true);
        expect(isCircleCreator(circle, "did:test:other")).toBe(false);
    });
    test("a circle without createdBy has no creator", () => {
        expect(isCircleCreator({}, CREATOR)).toBe(false);
        expect(isCircleCreator({}, undefined)).toBe(false);
        expect(isCircleCreator(null, CREATOR)).toBe(false);
    });
});

describe("canOfferAdminRemoval", () => {
    test("any other admin's row is left to the usual checks", () => {
        expect(canOfferAdminRemoval({ did: CREATOR }, circle, "did:test:admin")).toBe(true);
        expect(canOfferAdminRemoval({ did: "did:test:admin" }, circle, "did:test:admin")).toBe(true);
    });
    test("hidden on the creator's row for the creator, even as a superadmin (tim-solo)", () => {
        expect(canOfferAdminRemoval({ did: CREATOR }, circle, CREATOR)).toBe(false);
        expect(canOfferAdminRemoval({ did: CREATOR, isAdmin: true }, circle, CREATOR)).toBe(false);
    });
    test("hidden on the creator's row for another admin", () => {
        expect(canOfferAdminRemoval({ did: "did:test:admin" }, circle, CREATOR)).toBe(false);
    });
    test("shown on the creator's row for a superadmin who isn't the creator", () => {
        expect(canOfferAdminRemoval({ did: "did:test:super", isAdmin: true }, circle, CREATOR)).toBe(true);
    });
});
