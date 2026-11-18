// Minimal in-memory stand-in for a MongoDB collection, for tests that mock "@/lib/data/db".
// Supports only what the tests' subjects use: equality (a null filter value also matches a missing
// field; a scalar matches an array field that contains it, as in MongoDB), dotted paths, $in, $nin,
// $ne, $exists, $not, $size, $gt/$gte/$lt/$lte, RegExp values, top-level $or/$and/$nor, find().toArray() and
// find() with sort/limit/project, inclusion projections (dotted paths too), countDocuments, insertOne
// (adds an ObjectId _id when there is none), deleteOne, deleteMany,
// and updateOne ($set, $unset, $addToSet, $push (top-level, single value), $pull) / findOneAndUpdate with $set (findOneAndUpdate is atomic, as in MongoDB: nothing can run
// between its match and its write). $set takes dotted paths and the positional "$" (the first element
// that the filter's $elemMatch or "array.field" condition matched). A top-level $expr supports the few
// aggregation operators listed in evalExpr.

import { ObjectId } from "mongodb";

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
                    case "$elemMatch":
                        return (
                            Array.isArray(value) &&
                            value.some((element) =>
                                element && typeof element === "object" && !Array.isArray(element)
                                    ? matchesFilter(element as Doc, arg as Doc)
                                    : matchesCondition(element, arg),
                            )
                        );
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

const isMissing = (value: unknown) => value === null || value === undefined;

// Aggregation expressions, as far as $expr in the code under test needs them: "$field.path",
// "$$variable.path", literals, $lt/$lte/$gt/$gte/$eq/$ne, $size, $filter, $ifNull, $and/$or/$not.
const evalExpr = (doc: Doc, expr: unknown, vars: Record<string, unknown> = {}): unknown => {
    if (typeof expr === "string" && expr.startsWith("$$")) {
        const [name, ...rest] = expr.slice(2).split(".");
        const value = vars[name];
        return rest.length ? getPath(value as Doc, rest.join(".")) : value;
    }
    if (typeof expr === "string" && expr.startsWith("$")) {
        return getPath(doc, expr.slice(1));
    }
    if (Array.isArray(expr)) {
        return expr.map((item) => evalExpr(doc, item, vars));
    }
    if (!isOperatorObject(expr)) {
        return expr;
    }
    const [op, arg] = Object.entries(expr as Doc)[0];
    const args = () => (arg as unknown[]).map((item) => evalExpr(doc, item, vars));
    const truthy = (value: unknown) => !isMissing(value) && value !== false && value !== 0;
    switch (op) {
        case "$lt":
        case "$lte":
        case "$gt":
        case "$gte":
        case "$eq":
        case "$ne": {
            const [a, b] = args();
            // As in MongoDB's order, null and missing come before numbers and dates.
            const rank = (value: unknown) =>
                isMissing(value) ? -Infinity : value instanceof Date ? value.getTime() : (value as number);
            const x = rank(a);
            const y = rank(b);
            if (op === "$lt") return x < y;
            if (op === "$lte") return x <= y;
            if (op === "$gt") return x > y;
            if (op === "$gte") return x >= y;
            if (op === "$eq") return x === y;
            return x !== y;
        }
        case "$size": {
            const value = evalExpr(doc, arg, vars);
            if (!Array.isArray(value)) throw new Error("fake-collection: $size of a non-array");
            return value.length;
        }
        case "$filter": {
            const { input, as, cond } = arg as { input: unknown; as: string; cond: unknown };
            const list = evalExpr(doc, input, vars);
            if (!Array.isArray(list)) throw new Error("fake-collection: $filter of a non-array");
            return list.filter((item) => truthy(evalExpr(doc, cond, { ...vars, [as]: item })));
        }
        case "$ifNull": {
            const values = args();
            return values.find((value) => !isMissing(value)) ?? values[values.length - 1];
        }
        case "$and":
            return args().every(truthy);
        case "$or":
            return args().some(truthy);
        case "$not":
            return !truthy(Array.isArray(arg) ? args()[0] : evalExpr(doc, arg, vars));
        default:
            throw new Error(`fake-collection: unsupported expression operator ${op}`);
    }
};

export const matchesFilter = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([key, condition]) => {
        if (key === "$expr") {
            const value = evalExpr(doc, condition);
            return !isMissing(value) && value !== false && value !== 0;
        }
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
    const picked: Doc = idSpec === 0 ? {} : { _id: idSpec && typeof idSpec === "object" ? String(doc._id) : doc._id };
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

// The index the positional "$" stands for in "array.$.field": the first element of `array` that the
// filter's condition on it matched ($elemMatch, or "array.field" equality/operators).
const positionalIndex = (doc: Doc, filter: Doc, arrayKey: string): number => {
    const list = getPath(doc, arrayKey);
    if (!Array.isArray(list)) return -1;
    const direct = filter[arrayKey];
    if (direct && typeof direct === "object" && "$elemMatch" in direct) {
        return list.findIndex((element) => matchesFilter(element as Doc, (direct as Doc).$elemMatch));
    }
    const prefix = `${arrayKey}.`;
    const subFilter = Object.fromEntries(
        Object.entries(filter)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => [key.slice(prefix.length), value]),
    );
    if (Object.keys(subFilter).length === 0) return -1;
    return list.findIndex((element) => matchesFilter(element as Doc, subFilter));
};

// Replaces each positional "$" with the matched index, worked out on the document before any write
// (as MongoDB does), so a $set of several "list.$.x" keys all land on the same element.
const resolvePositional = (doc: Doc, filter: Doc, key: string): string => {
    const parts = key.split(".");
    return parts
        .map((part, i) => {
            if (part !== "$") return part;
            const index = positionalIndex(doc, filter, parts.slice(0, i).join("."));
            if (index === -1) throw new Error(`fake-collection: no element for the positional $ in ${key}`);
            return String(index);
        })
        .join(".");
};

// $set of a dotted path ("a.b", "list.2.field"), creating objects on the way.
const setPath = (doc: Doc, key: string, value: unknown) => {
    const parts = key.split(".");
    let target: any = doc;
    for (const part of parts.slice(0, -1)) {
        target = target[part] ??= {};
    }
    target[parts[parts.length - 1]] = value;
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
        async insertOne(doc: Doc) {
            const stored = { ...doc, _id: doc._id ?? new ObjectId() };
            for (const [key, value] of Object.entries(stored)) {
                if (value === undefined) {
                    throw new Error(`fake-collection: explicit undefined written to ${key}`);
                }
            }
            docs.push(stored);
            return { acknowledged: true, insertedId: stored._id };
        },
        async insertMany(many: Doc[]) {
            const insertedIds: unknown[] = [];
            for (const doc of many) {
                insertedIds.push((await this.insertOne(doc)).insertedId);
            }
            return { acknowledged: true, insertedCount: many.length, insertedIds };
        },
        async deleteOne(filter: Doc) {
            queries.push(filter);
            const index = docs.findIndex((d) => matchesFilter(d, filter));
            if (index === -1) {
                return { deletedCount: 0 };
            }
            docs.splice(index, 1);
            return { deletedCount: 1 };
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
        async updateOne(filter: Doc, update: { $set?: Doc; $unset?: Doc; $addToSet?: Doc; $push?: Doc; $pull?: Doc }) {
            const found = docs.find((d) => matchesFilter(d, filter));
            if (!found) {
                return { matchedCount: 0, modifiedCount: 0 };
            }
            const sets = Object.entries(update.$set ?? {}).map(
                ([key, value]) => [resolvePositional(found, filter, key), value] as const,
            );
            for (const [key, value] of sets) {
                if (value === undefined) {
                    // The real driver (no ignoreUndefined) would store null here; fail loudly instead.
                    throw new Error(`fake-collection: explicit undefined written to ${key}`);
                }
                setPath(found, key, value);
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
            for (const [key, value] of Object.entries(update.$push ?? {})) {
                found[key] = [...(Array.isArray(found[key]) ? found[key] : []), value];
            }
            for (const [key, value] of Object.entries(update.$pull ?? {})) {
                if (Array.isArray(found[key]))
                    found[key] = found[key].filter((item: unknown) => !valueEquals(item, value));
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
