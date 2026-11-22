import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreatorBadge } from "./creator-badge";

const CREATOR = "did:test:creator";

describe("CreatorBadge", () => {
    test("shows Creator on the creator's row", () => {
        expect(renderToStaticMarkup(<CreatorBadge circle={{ createdBy: CREATOR }} userDid={CREATOR} />)).toContain(
            "Creator",
        );
    });
    test("nothing on anyone else's row", () => {
        expect(renderToStaticMarkup(<CreatorBadge circle={{ createdBy: CREATOR }} userDid="did:test:admin" />)).toBe(
            "",
        );
    });
    test("nothing when the circle has no recorded creator", () => {
        expect(renderToStaticMarkup(<CreatorBadge circle={{}} userDid={CREATOR} />)).toBe("");
    });
});
