"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("jasmine");
const util_1 = require("./util");
const js_1 = require("../js");
describe("One-off twoslasher", () => {
    const options = {
        twoslashServerBinaryPath: util_1.SERVER_BINARY_UNDER_TEST,
    };
    it("should handle single-line inputs", () => {
        const input = "fn foo() -> bool { 1 }";
        const result = (0, js_1.twoslasher)(input, ".rs", options);
        expect(result.code).toBe(input);
        expect(result.errors.length).toBe(2);
        const [e1, e2] = result.errors;
        (0, util_1.expectSpanAndText)(input, e1, "renderedMessage", "1", "expected bool, found i32");
        (0, util_1.expectSpanAndText)(input, e2, "renderedMessage", "{ 1 }", "expected bool, found i32");
        expect(result.queries.length).toBe(0);
        expect(result.staticQuickInfos.length).toBe(2);
        const [h1, h2] = result.staticQuickInfos;
        (0, util_1.expectSpanAndText)(input, h1, "text", "foo", "fn foo() -> bool");
        (0, util_1.expectSpanAndText)(input, h2, "text", "bool", "bool");
    });
    it("should handle multi-line inputs", () => {
        const input = `
enum Color { Red, Green, Blue }
enum Palette { Mauve, Aqua }
`.trim();
        const result = (0, js_1.twoslasher)(input, ".rs", options);
        expect(result.code).toBe(input);
        expect(result.errors.length).toBe(0);
        expect(result.queries.length).toBe(0);
        expect(result.staticQuickInfos.length).toBe(7);
        const hs = result.staticQuickInfos;
        const expected = [
            ["Color", "enum Color"],
            ["Red", "Color\n\nRed"],
            ["Green", "Color\n\nGreen"],
            ["Blue", "Color\n\nBlue"],
            ["Palette", "enum Palette"],
            ["Mauve", "Palette\n\nMauve"],
            ["Aqua", "Palette\n\nAqua"],
        ];
        expected.forEach(([span, text], i) => {
            (0, util_1.expectSpanAndText)(input, hs[i], "text", span, text);
        });
    });
});
//# sourceMappingURL=oneoff.spec.js.map