import { describe, expect, test } from "bun:test";
import { ACTION_FAILED_MESSAGE, callAction } from "./call-action";

describe("callAction", () => {
    test("passes a result through", async () => {
        expect(await callAction(async () => ({ success: true, message: "ok" }))).toEqual({
            success: true,
            message: "ok",
        });
        expect(await callAction(async () => ({ success: false, message: "refused" }))).toEqual({
            success: false,
            message: "refused",
        });
    });

    test("a throw becomes a failed result with a readable message", async () => {
        const original = console.error;
        let logged = 0;
        console.error = () => {
            logged++;
        };
        expect(
            await callAction(async () => {
                throw new TypeError("Failed to fetch");
            }),
        ).toEqual({ success: false, message: ACTION_FAILED_MESSAGE });
        console.error = original;
        expect(logged).toBe(1);
    });
});
