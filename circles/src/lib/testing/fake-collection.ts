// Minimal in-memory stand-in for a MongoDB collection, for tests that mock "@/lib/data/db".
// Supports only what the tests' subjects use: equality (a null filter value also matches a missing
// field; a scalar matches an array field that contains it, as in MongoDB), dotted paths, $in, $nin,
// $ne, $exists, $not, $size, $gt/$gte/$lt/$lte, RegExp values, top-level $or/$and/$nor, find().toArray() and
// find() with sort/limit/project, inclusion projections (dotted paths too), countDocuments, deleteMany,
// and updateOne ($set, $unset, $addToSet, $pull) / findOneAndUpdate with $set (findOneAndUpdate is atomic, as in MongoDB: nothing can run
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

// A dotted path through an array reads that field of every element, as in MongoDB
// ("reactions.userDid" on [{userDid: a}, {userDid: b}] is [a, b]).
const getPath = (doc: Doc, key: string): unknown =>
    key.split(".").reduce<unknown>((value, part) => {
        if (Array.isArray(value) && !/^\d+$/.test(part)) {
            return value.flatMap((element) =>
                element && typeof element === "object" && (element as Doc)[part] !== undefined
                    ? [(element as Doc)[part]]
                    : [],
            );
        }
        return value && typeof value === "object" ? (value as Doc)[part] : undefined;
    }, doc);

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
        if (key === "$nor") return !(condition as Doc[]).some((sub) => matchesFilter(doc, sub));
        return matchesCondition(getPath(doc, key), condition);
    });

// Inclusion projections only (what the code under test uses), dotted paths included; _id always kept
// (as a string for `_id: { $toString: "$_id" }`; _id: 0 drops it).
const applyProjection = (doc: Doc, projection?: Record<string, unknown>): Doc => {
    if (!projection) {
        return { ...doc };
    }
    const idSpec = projection._id;
    const picked: Doc =
        idSpec === 0 ? {} : { _id: idSpec && typeof idSpec === "object" ? String(doc._id) : doc._id };
    for (const key of Object.keys(projection)) {
        if (key === "_id" || !projection[key]) continue;
        const value = getPath(doc, key);
        if (value === undefined) {
            continue;
        }
        const parts = key.split(".");
        let target = picked;
        for (const part of parts.slice(0, -1)) {
            target = target[part] ??= {};
        }
        target[parts[parts.length - 1]] = value;
    }
    return picked;
};

export const createFakeCollection = (initial: Doc[] = []) => {
    const docs: Doc[] = initial.map((d) => ({ ...d }));
    const queries: Doc[] = [];

    return {
        docs,
        queries,
        async findOne(filter: Doc, options?: { projection?: Record<string, unknown> }) {
            queries.push(filter);
            const found = docs.find((d) => matchesFilter(d, filter));
            if (!found) {
                return null;
            }
            return applyProjection(found, options?.projection);
        },
        find(filter: Doc, options?: { projection?: Record<string, unknown> }) {
            queries.push(filter);
            // Chainable like a driver cursor: sort/limit/project in any order, then toArray.
            const cursor = (
                sortSpec?: Record<string, 1 | -1>,
                max?: number,
                projection: Record<string, unknown> | undefined = options?.projection,
            ): any => ({
                sort: (spec: Record<string, 1 | -1>) => cursor(spec, max, projection),
                limit: (n: number) => cursor(sortSpec, n, projection),
                project: (spec: Record<string, unknown>) => cursor(sortSpec, max, spec),
                toArray: async () => {
                    const found = docs.filter((d) => matchesFilter(d, filter));
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
                    const limited = max === undefined ? found : found.slice(0, max);
                    return limited.map((d) => applyProjection(d, projection));
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
        async updateOne(filter: Doc, update: { $set?: Doc; $unset?: Doc; $addToSet?: Doc; $pull?: Doc }) {
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
            // Top-level fields only.
            for (const key of Object.keys(update.$unset ?? {})) {
                delete found[key];
            }
            // Top-level array fields and single values only.
            for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
                const list: unknown[] = Array.isArray(found[key]) ? found[key] : [];
                found[key] = list.some((item) => valueEquals(item, value)) ? list : [...list, value];
            }
            for (const [key, value] of Object.entries(update.$pull ?? {})) {
                if (Array.isArray(found[key])) found[key] = found[key].filter((item: unknown) => !valueEquals(item, value));
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
