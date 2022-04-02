import "jasmine";
export declare const SERVER_BINARY_UNDER_TEST: string;
export declare function expectSpan(input: string, { start, length }: {
    start?: number;
    length?: number;
}, expected: string): void;
export declare function expectText<K extends string, T extends Record<K, string>>(val: T, key: K, expected: string): void;
export declare function expectSpanAndText<K extends string, T extends {
    start?: number;
    length?: number;
} & Record<K, string>>(input: string, val: T, key: K, expectedSpan: string, expectedText: string): void;
