// Minimal in-memory stand-in for a MongoDB collection, for tests that mock "@/lib/data/db".
// Supports only what the auth/email actions use: equality (a null filter value also matches a
// missing field, as in MongoDB), $in, $ne, $exists, and updateOne with $set.

type Doc = Record<string, any>;

const valueEquals = (a: unknown, b: unknown): boolean => {
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    if (a && b && typeof a === "object" && typeof b === "object" && "toString" in a && "toString" in b) {
        return String(a) === String(b);
    }
    return a === b;
};

const matchesCondition = (value: unknown, condition: unknown): boolean => {
    if (condition === null) {
        return value === null || value === undefined;
    }
    if (condition && typeof condition === "object" && !(condition instanceof Date) && !Array.isArray(condition)) {
        const ops = condition as Record<string, unknown>;
        const keys = Object.keys(ops);
        if (keys.length > 0 && keys.every((k) => k.startsWith("$"))) {
            return keys.every((op) => {
                const arg = ops[op];
                switch (op) {
                    case "$in":
                        return (arg as unknown[]).some((candidate) => matchesCondition(value, candidate));
                    case "$ne":
                        return !matchesCondition(value, arg);
                    case "$exists":
                        return (value !== undefined) === Boolean(arg);
                    default:
                        throw new Error(`fake-collection: unsupported operator ${op}`);
                }
            });
        }
    }
    return valueEquals(value, condition);
};

export const matchesFilter = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([key, condition]) => matchesCondition(doc[key], condition));

export const createFakeCollection = (initial: Doc[] = []) => {
    const docs: Doc[] = initial.map((d) => ({ ...d }));
    const queries: Doc[] = [];

    return {
        docs,
        queries,
        async findOne(filter: Doc, options?: { projection?: Record<string, 0 | 1> }) {
            queries.push(filter);
            const found = docs.find((d) => matchesFilter(d, filter));
            if (!found) {
                return null;
            }
            if (options?.projection) {
                const picked: Doc = { _id: found._id };
                for (const key of Object.keys(options.projection)) {
                    if (key in found) {
                        picked[key] = found[key];
                    }
                }
                return picked;
            }
            return { ...found };
        },
        async updateOne(filter: Doc, update: { $set?: Doc }) {
            const found = docs.find((d) => matchesFilter(d, filter));
            if (!found) {
                return { matchedCount: 0, modifiedCount: 0 };
            }
            for (const [key, value] of Object.entries(update.$set ?? {})) {
                if (value === undefined) {
                    // The real driver (no ignoreUndefined) would store null here; fail loudly instead.
                    throw new Error(`fake-collection: explicit undefined written to ${key}`);
                }
                found[key] = value;
            }
            return { matchedCount: 1, modifiedCount: 1 };
        },
    };
};

export type FakeCollection = ReturnType<typeof createFakeCollection>;
