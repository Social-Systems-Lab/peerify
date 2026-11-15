// Where a ?redirectTo= may send someone after logging in or signing up (Tim, 2026-11-15). Only a
// path on this site: a single leading "/". Not a full URL ("https://elsewhere"), not
// protocol-relative ("//elsewhere", or "/\elsewhere", which browsers read the same way), not
// "javascript:", and nothing with spaces or control characters (browsers drop tabs and newlines, so
// "/\t/elsewhere" would become "//elsewhere"). Anything else gives the fallback, the normal start
// page.

const LOCAL_BASE = "https://peerify.invalid";

export const isSafeRedirectPath = (value: unknown): value is string => {
    if (typeof value !== "string" || value.length === 0) return false;
    if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") return false;
    // Whitespace, control characters and backslashes have no place in our own paths.
    if (/[\s\u0000-\u001f\u007f\\]/.test(value)) return false;
    try {
        return new URL(value, LOCAL_BASE).origin === LOCAL_BASE;
    } catch {
        return false;
    }
};

export const safeRedirectPath = (value: string | null | undefined, fallback: string): string =>
    isSafeRedirectPath(value) ? value : fallback;
