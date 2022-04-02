import "jasmine";
import * as path from "path";

export const SERVER_BINARY_UNDER_TEST = path.resolve(
  __dirname,
  "../../target/release/rust-twoslash"
);

export function expectSpan(
  input: string,
  { start, length }: { start?: number; length?: number },
  expected: string
) {
  expect(input.substring(start!, start! + length!)).toBe(expected);
}

export function expectText<K extends string, T extends Record<K, string>>(
  val: T,
  key: K,
  expected: string
) {
  expect(val[key]).toBe(expected);
}

export function expectSpanAndText<
  K extends string,
  T extends { start?: number; length?: number } & Record<K, string>
>(input: string, val: T, key: K, expectedSpan: string, expectedText: string) {
  expectSpan(input, val, expectedSpan);
  expectText(val, key, expectedText);
}
