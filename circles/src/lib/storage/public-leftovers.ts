// Pure helpers for scripts/delete-public-leftovers.ts: which files in the public bucket have a
// name /storage and /uploads refuse (lib/storage/refused-names.ts) and are mentioned by nothing in
// the database. Kept here, without I/O, so the matching can be unit tested.
//
// "Mentioned" is deliberately broad: a document mentions a file if its file name (the last path
// segment, any case) appears anywhere in the document's text, in any field. A false "mentioned"
// only keeps a file; a false "unreferenced" would delete one that is still used.

import { isRefusedPublicName } from "./refused-names";

export type PublicObject = { name: string; size: number };

export const fileNameOf = (key: string): string => (key.split("/").pop() ?? "").toLowerCase();

export const createLeftoverScan = (objects: PublicObject[]) => {
    const candidates = objects
        .filter((o) => isRefusedPublicName(o.name))
        .map((o) => ({ ...o, needle: fileNameOf(o.name) }))
        .filter((o) => o.needle.length > 0);
    const mentioned = new Set<string>();
    return {
        candidates: candidates.map(({ needle: _needle, ...o }) => o),
        // Call once per document, with the document as text (EJSON).
        scan(text: string) {
            const lower = text.toLowerCase();
            for (const c of candidates) {
                if (!mentioned.has(c.name) && lower.includes(c.needle)) mentioned.add(c.name);
            }
        },
        mentionedCount: () => mentioned.size,
        unreferenced: (): PublicObject[] =>
            candidates.filter((c) => !mentioned.has(c.name)).map(({ name, size }) => ({ name, size })),
    };
};
