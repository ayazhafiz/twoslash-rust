"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectSpanAndText = exports.expectText = exports.expectSpan = exports.SERVER_BINARY_UNDER_TEST = void 0;
require("jasmine");
const path = require("path");
exports.SERVER_BINARY_UNDER_TEST = path.resolve(__dirname, "../../target/release/rust-twoslash");
function expectSpan(input, { start, length }, expected) {
    expect(input.substring(start, start + length)).toBe(expected);
}
exports.expectSpan = expectSpan;
function expectText(val, key, expected) {
    expect(val[key]).toBe(expected);
}
exports.expectText = expectText;
function expectSpanAndText(input, val, key, expectedSpan, expectedText) {
    expectSpan(input, val, expectedSpan);
    expectText(val, key, expectedText);
}
exports.expectSpanAndText = expectSpanAndText;
//# sourceMappingURL=util.js.map