"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.twoslasher = exports.shutdownServer = exports.startServer = void 0;
const shim_1 = require("./shim");
const synckit_1 = require("synckit");
var shim_2 = require("./shim");
Object.defineProperty(exports, "startServer", { enumerable: true, get: function () { return shim_2.startServer; } });
Object.defineProperty(exports, "shutdownServer", { enumerable: true, get: function () { return shim_2.shutdownServer; } });
const runAsServerWorkerPath = require.resolve("./run_as_server_worker");
function twoslasher(code, _extension, options = {}) {
    var _a;
    const serverId = options.twoslashRustServerId;
    const serverBinaryPath = (_a = options.twoslashServerBinaryPath) !== null && _a !== void 0 ? _a : shim_1.DEFAULT_SERVER_BINARY_IN_PATH;
    if (serverId) {
        // As much as I wish we didn't have to do this, I can't think of a better
        // way. The reason is that consumers want a sync version of `twoslasher`.
        // Hopefully this won't hang the thread... unfortunately, we don't always
        // know that it won't.
        const runAsServer = (0, synckit_1.createSyncFn)(runAsServerWorkerPath);
        return runAsServer(code, serverId);
    }
    return (0, shim_1.runStandalone)(code, serverBinaryPath);
}
exports.twoslasher = twoslasher;
//# sourceMappingURL=index.js.map