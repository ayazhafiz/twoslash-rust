"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const synckit_1 = require("synckit");
const shim_1 = require("./shim");
(0, synckit_1.runAsWorker)((code, serverId) => (0, shim_1.runWithServer)(code, serverId));
//# sourceMappingURL=run_as_server_worker.js.map