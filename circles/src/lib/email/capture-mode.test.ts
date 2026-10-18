// Run: bun test src/lib/email/capture-mode.test.ts
// No mocks: capture-mode.ts has no database imports. register() is exercised with process.exit stubbed.

import { afterAll, describe, expect, test } from "bun:test";
import { checkEmailCaptureMode, enforceEmailCaptureModeAtBoot, isEmailCaptureOn } from "./capture-mode";

const STAGING = "https://cleura-staging.peerify.one";

describe("checkEmailCaptureMode", () => {
    test("off when unset, empty or off, whatever the URLs", () => {
        for (const value of [undefined, "", "off"]) {
            expect(checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: value, CIRCLES_URL: "https://peerify.one" })).toEqual({
                mode: "off",
            });
        }
    });

    test("on for the staging hosts and local dev", () => {
        for (const url of [STAGING, "https://staging.peerify.one", "http://localhost:3001", "http://127.0.0.1:3000/x"]) {
            expect(checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: url })).toEqual({ mode: "on" });
        }
        expect(
            checkEmailCaptureMode({
                EMAIL_CAPTURE_MODE: "on",
                CIRCLES_URL: STAGING,
                NEXT_PUBLIC_APP_URL: STAGING,
                NEXT_PUBLIC_SITE_URL: STAGING,
            }),
        ).toEqual({ mode: "on" });
    });

    test("refused for prod and any other host", () => {
        for (const url of [
            "https://peerify.one",
            "https://www.peerify.one",
            "https://PEERIFY.ONE",
            "https://evil.example",
            "https://staging.peerify.one.evil.example",
            "https://cleura.peerify.one",
            "not a url",
            "ftp://staging.peerify.one",
        ]) {
            const check = checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: url });
            expect(check.mode).toBe("refused");
        }
    });

    test("refused without CIRCLES_URL", () => {
        expect(checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: "on" }).mode).toBe("refused");
        expect(checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: "on", NEXT_PUBLIC_APP_URL: STAGING }).mode).toBe("refused");
    });

    test("refused when any other base URL setting points elsewhere", () => {
        for (const name of ["NEXT_PUBLIC_APP_URL", "APP_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL"]) {
            const check = checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: STAGING, [name]: "https://peerify.one" });
            expect(check.mode).toBe("refused");
            expect(check.mode === "refused" && check.reason).toContain(name);
        }
    });

    test("any value other than on/off/empty is refused, and not echoed", () => {
        for (const value of ["true", "ON", "1", "yes", " on", "on "]) {
            const check = checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: value, CIRCLES_URL: STAGING });
            expect(check.mode).toBe("refused");
        }
        const check = checkEmailCaptureMode({ EMAIL_CAPTURE_MODE: "pk_live_should_not_show", CIRCLES_URL: STAGING });
        expect(check.mode === "refused" && check.reason).not.toContain("pk_live");
    });

    test("isEmailCaptureOn is true only for an allowed on", () => {
        expect(isEmailCaptureOn({ EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: STAGING })).toBe(true);
        expect(isEmailCaptureOn({ EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: "https://peerify.one" })).toBe(false);
        expect(isEmailCaptureOn({ CIRCLES_URL: STAGING })).toBe(false);
    });
});

// With capture off, no URL setting may ever stop the app: whatever CIRCLES_URL and the other base URL
// settings say (prod, unknown hosts, invalid values, missing), off means off and the guard does nothing.
const OFF_VALUES: (string | undefined)[] = [undefined, "", "off"];
const URL_SETUPS: Record<string, string | undefined>[] = [
    {},
    { CIRCLES_URL: "https://peerify.one" },
    { CIRCLES_URL: "https://peerify.one", NEXT_PUBLIC_APP_URL: "https://peerify.one", NEXT_PUBLIC_SITE_URL: "https://peerify.one" },
    { CIRCLES_URL: "not a url", APP_URL: "::::", SITE_URL: "javascript:alert(1)" },
    { CIRCLES_URL: "https://evil.example", NEXT_PUBLIC_APP_URL: "https://cleura-staging.peerify.one" },
    { NEXT_PUBLIC_APP_URL: "https://peerify.one" },
    { CIRCLES_URL: "" },
];

describe("capture mode off never stops the app, whatever the URL settings", () => {
    test("check is off, and the boot guard neither exits nor fails", () => {
        for (const value of OFF_VALUES) {
            for (const urls of URL_SETUPS) {
                const env = { ...urls, EMAIL_CAPTURE_MODE: value };
                expect(checkEmailCaptureMode(env)).toEqual({ mode: "off" });
                const exits: number[] = [];
                expect(enforceEmailCaptureModeAtBoot(env, (code) => exits.push(code))).toEqual({ mode: "off" });
                expect(exits).toEqual([]);
            }
        }
    });
});

describe("enforceEmailCaptureModeAtBoot", () => {
    const run = (env: Record<string, string>) => {
        const exits: number[] = [];
        const check = enforceEmailCaptureModeAtBoot(env, (code) => exits.push(code));
        return { check, exits };
    };

    test("a refused setting exits with code 1", () => {
        expect(run({ EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: "https://peerify.one" }).exits).toEqual([1]);
        expect(run({ EMAIL_CAPTURE_MODE: "true", CIRCLES_URL: STAGING }).exits).toEqual([1]);
    });

    test("off and an allowed on don't exit", () => {
        expect(run({ CIRCLES_URL: "https://peerify.one" }).exits).toEqual([]);
        expect(run({ EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: STAGING }).exits).toEqual([]);
    });
});

describe("instrumentation register()", () => {
    const saved = { ...process.env };
    const realExit = process.exit;
    afterAll(() => {
        process.env = saved;
        process.exit = realExit;
    });

    const runRegister = async (env: Record<string, string | undefined>) => {
        // undefined means "not set": the key is removed, never stored as the string "undefined".
        const merged: Record<string, string | undefined> = { ...saved, ...env };
        for (const key of Object.keys(merged)) {
            if (merged[key] === undefined) delete merged[key];
        }
        process.env = merged as NodeJS.ProcessEnv;
        const exits: unknown[] = [];
        process.exit = ((code?: number) => {
            exits.push(code);
        }) as typeof process.exit;
        const { register } = await import("../../instrumentation");
        await register();
        process.exit = realExit;
        return exits;
    };

    test("exits on the node runtime with a refused setting", async () => {
        expect(await runRegister({ NEXT_RUNTIME: "nodejs", IS_BUILD: undefined, EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: "https://peerify.one" })).toEqual([1]);
    });

    test("does nothing during the build or in the edge runtime", async () => {
        const refused = { EMAIL_CAPTURE_MODE: "on", CIRCLES_URL: "https://peerify.one" };
        expect(await runRegister({ ...refused, NEXT_RUNTIME: "nodejs", IS_BUILD: "true" })).toEqual([]);
        expect(await runRegister({ ...refused, NEXT_RUNTIME: "edge", IS_BUILD: undefined })).toEqual([]);
    });

    test("does nothing with capture mode unset (prod)", async () => {
        expect(await runRegister({ NEXT_RUNTIME: "nodejs", IS_BUILD: undefined, EMAIL_CAPTURE_MODE: undefined, CIRCLES_URL: "https://peerify.one" })).toEqual([]);
    });

    test("never exits with capture unset, empty or off, whatever the URL settings", async () => {
        const allUrlNames = ["CIRCLES_URL", "NEXT_PUBLIC_APP_URL", "APP_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL"];
        for (const value of OFF_VALUES) {
            for (const urls of URL_SETUPS) {
                // Clear every URL setting first, so only this setup's values are present.
                const cleared = Object.fromEntries(allUrlNames.map((name) => [name, undefined]));
                const exits = await runRegister({
                    ...cleared,
                    ...urls,
                    NEXT_RUNTIME: "nodejs",
                    IS_BUILD: undefined,
                    EMAIL_CAPTURE_MODE: value,
                });
                expect(exits).toEqual([]);
            }
        }
    });
});
