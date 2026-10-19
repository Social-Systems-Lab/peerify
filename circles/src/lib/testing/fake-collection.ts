// Minimal in-memory stand-in for a MongoDB collection, for tests that mock "@/lib/data/db".
// Supports only what the tests' subjects use: equality (a null filter value also matches a missing
// field; a scalar matches an array field that contains it, as in MongoDB), dotted paths, $in, $nin,
// $ne, $exists, $not, $size, $gt/$gte/$lt/$lte, RegExp values, top-level $or/$and, find().toArray() and
// find() with sort/limit, countDocuments, deleteMany,
// and updateOne / findOneAndUpdate with $set (findOneAndUpdate is atomic, as in MongoDB: nothing can run
// between its match and its write).

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

const isOperatorObject = (condition: unknown): boolean =>
    !!condition &&
    typeof condition === "object" &&
    !(condition instanceof Date) &&
    !Array.isArray(condition) &&
    Object.keys(condition).length > 0 &&
    Object.keys(condition).every((k) => k.startsWith("$"));

const getPath = (doc: Doc, key: string): unknown =>
    key
        .split(".")
        .reduce<unknown>((value, part) => (value && typeof value === "object" ? (value as Doc)[part] : undefined), doc);

const matchesCondition = (value: unknown, condition: unknown): boolean => {
    // A scalar condition matches an array field if any element matches (MongoDB semantics).
    if (Array.isArray(value) && !Array.isArray(condition) && !isOperatorObject(condition)) {
        return value.some((element) => matchesCondition(element, condition));
    }
    if (condition === null) {
        return value === null || value === undefined;
    }
    if (condition instanceof RegExp) {
        return typeof value === "string" && condition.test(value);
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
                    case "$nin":
                        return !(arg as unknown[]).some((candidate) => matchesCondition(value, candidate));
                    case "$exists":
                        return (value !== undefined) === Boolean(arg);
                    case "$not":
                        return !matchesCondition(value, arg);
                    case "$size":
                        return Array.isArray(value) && value.length === arg;
                    case "$gt":
                    case "$gte":
                    case "$lt":
                    case "$lte": {
                        if (value === null || value === undefined) return false;
                        const a = value instanceof Date ? value.getTime() : (value as number);
                        const b = arg instanceof Date ? arg.getTime() : (arg as number);
                        return op === "$gt" ? a > b : op === "$gte" ? a >= b : op === "$lt" ? a < b : a <= b;
                    }
                    default:
                        throw new Error(`fake-collection: unsupported operator ${op}`);
                }
            });
        }
    }
    return valueEquals(value, condition);
};

export const matchesFilter = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([key, condition]) => {
        if (key === "$or") return (condition as Doc[]).some((sub) => matchesFilter(doc, sub));
        if (key === "$and") return (condition as Doc[]).every((sub) => matchesFilter(doc, sub));
        return matchesCondition(getPath(doc, key), condition);
    });

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
        find(filter: Doc) {
            queries.push(filter);
            // Chainable like a driver cursor: sort/limit in any order, then toArray.
            const cursor = (sortSpec?: Record<string, 1 | -1>, max?: number) => ({
                sort: (spec: Record<string, 1 | -1>) => cursor(spec, max),
                limit: (n: number) => cursor(sortSpec, n),
                toArray: async () => {
                    const found = docs.filter((d) => matchesFilter(d, filter)).map((d) => ({ ...d }));
                    if (sortSpec) {
                        const keys = Object.entries(sortSpec);
                        found.sort((x, y) => {
                            for (const [key, dir] of keys) {
                                const a = getPath(x, key) as any;
                                const b = getPath(y, key) as any;
                                if (a < b) return -dir;
                                if (a > b) return dir;
                            }
                            return 0;
                        });
                    }
                    return max === undefined ? found : found.slice(0, max);
                },
            });
            return cursor();
        },
        async countDocuments(filter: Doc) {
            return docs.filter((d) => matchesFilter(d, filter)).length;
        },
        async deleteMany(filter: Doc) {
            let deletedCount = 0;
            for (let i = docs.length - 1; i >= 0; i--) {
                if (matchesFilter(docs[i], filter)) {
                    docs.splice(i, 1);
                    deletedCount++;
                }
            }
            return { deletedCount };
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
        async findOneAndUpdate(filter: Doc, update: { $set?: Doc }, options?: { returnDocument?: "before" | "after" }) {
            queries.push(filter);
            const found = docs.find((d) => matchesFilter(d, filter));
            if (!found) {
                return null;
            }
            const before = { ...found };
            for (const [key, value] of Object.entries(update.$set ?? {})) {
                if (value === undefined) {
                    throw new Error(`fake-collection: explicit undefined written to ${key}`);
                }
                found[key] = value;
            }
            return options?.returnDocument === "after" ? { ...found } : before;
        },
    };
};

export type FakeCollection = ReturnType<typeof createFakeCollection>;
