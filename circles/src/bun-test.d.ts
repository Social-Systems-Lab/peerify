// Just enough of bun's "bun:test" API for `tsc --noEmit` to check the bun-run test files, without
// adding bun-types as a dependency. Tests run with `bun test <file>`, which supplies the real module.
declare module "bun:test" {
    type Matchers = {
        toBe(expected: unknown): void;
        toEqual(expected: unknown): void;
        toBeNull(): void;
        toBeString(): void;
        toBeGreaterThan(expected: number): void;
        toBeLessThanOrEqual(expected: number): void;
        toHaveLength(expected: number): void;
        toContain(expected: unknown): void;
        not: Matchers;
    };
    export function describe(name: string, fn: () => void): void;
    export function test(name: string, fn: () => void | Promise<void>): void;
    export function beforeEach(fn: () => void | Promise<void>): void;
    export function expect(actual: unknown): Matchers;
    export const mock: {
        module(specifier: string, factory: () => Record<string, unknown>): void;
    };
}
