"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runStandalone = exports.shutdownServer = exports.runWithServer = exports.startServer = exports.DEFAULT_SERVER_BINARY_IN_PATH = void 0;
const cp = require("child_process");
const fs = require("fs");
const net = require("net");
const uuid_1 = require("uuid");
const proper_lockfile_1 = require("proper-lockfile");
const SERVER_TABLE_FILE = "/tmp/twoslash-rust-servers.json";
exports.DEFAULT_SERVER_BINARY_IN_PATH = "rust-twoslash";
function readServerTable() {
    const table = fs.readFileSync(SERVER_TABLE_FILE, "utf8");
    return JSON.parse(table);
}
function commitServerTable(table) {
    fs.writeFileSync(SERVER_TABLE_FILE, JSON.stringify(table));
}
function lockTable(go) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!fs.existsSync(SERVER_TABLE_FILE)) {
            // Ensure the table exists. NB: possible race here, but I don't think it's a
            // big deal.
            fs.writeFileSync(SERVER_TABLE_FILE, JSON.stringify({}));
        }
        const release = yield (0, proper_lockfile_1.lock)(SERVER_TABLE_FILE);
        const result = yield go();
        yield release();
        return result;
    });
}
function addServer(uuid, address) {
    return __awaiter(this, void 0, void 0, function* () {
        return lockTable(() => __awaiter(this, void 0, void 0, function* () {
            const table = readServerTable();
            table[uuid] = address;
            commitServerTable(table);
        }));
    });
}
function removeServer(uuid) {
    return __awaiter(this, void 0, void 0, function* () {
        return lockTable(() => __awaiter(this, void 0, void 0, function* () {
            const table = readServerTable();
            delete table[uuid];
            commitServerTable(table);
        }));
    });
}
function getServer(uuid) {
    return __awaiter(this, void 0, void 0, function* () {
        return lockTable(() => __awaiter(this, void 0, void 0, function* () {
            const table = readServerTable();
            const addr = table[uuid];
            const [host, port] = addr.split(":");
            return [host, Number(port)];
        }));
    });
}
function startServer(useCargo = false, projectName, serverBinaryPath = exports.DEFAULT_SERVER_BINARY_IN_PATH) {
    return __awaiter(this, void 0, void 0, function* () {
        const uuid = (0, uuid_1.v4)();
        const env = Object.assign(Object.assign({}, process.env), { TWOSLASH_SERVER_UUID: uuid, TWOSLASH_USE_CARGO: useCargo ? "1" : "0" });
        if (projectName) {
            env.TWOSLASH_PROJECT_NAME = projectName;
        }
        const child = cp.spawn(serverBinaryPath, [], {
            env,
            detached: true,
            stdio: ["ignore", "pipe", "ignore"],
        });
        const server_address = yield new Promise((resolve, reject) => {
            let stdout = "";
            child.stdout.on("data", (e) => {
                stdout += e.toString("utf8");
                if (stdout.includes("\n")) {
                    child.stdout.destroy();
                    resolve(stdout.trim());
                }
            });
            child.on("exit", () => reject());
        });
        yield addServer(uuid, server_address);
        child.unref();
        return { uuid };
    });
}
exports.startServer = startServer;
function protocolWrite(stream, data) {
    const buffer = Buffer.from(data, "binary");
    const protoBuffer = Buffer.alloc(4 + buffer.length);
    protoBuffer.writeUInt32BE(buffer.length);
    buffer.copy(protoBuffer, 4);
    stream.write(protoBuffer);
}
function protocolRead(stream) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            let buffer = Buffer.from("");
            let messageSize;
            stream.on("data", (chunk) => {
                buffer = Buffer.concat([buffer, chunk], buffer.length + chunk.length);
                if (buffer.length >= 4) {
                    messageSize = buffer.readUInt32BE();
                }
                if (messageSize && buffer.length >= messageSize + 4) {
                    let result = buffer.toString("utf8", 4, 4 + messageSize);
                    resolve(result);
                }
            });
        });
    });
}
function runWithServer(code, serverId) {
    return __awaiter(this, void 0, void 0, function* () {
        const [host, port] = yield getServer(serverId);
        const client = new net.Socket();
        client.connect(port, host, () => {
            protocolWrite(client, code);
        });
        return protocolRead(client).then((data) => {
            client.destroy();
            return JSON.parse(data);
        });
    });
}
exports.runWithServer = runWithServer;
function shutdownServer(serverId) {
    return __awaiter(this, void 0, void 0, function* () {
        const [host, port] = yield getServer(serverId);
        const client = new net.Socket();
        return new Promise((resolve) => {
            client.connect(port, host, () => {
                protocolWrite(client, `Shutdown ${serverId}`);
                client.destroy();
                removeServer(serverId).then(resolve);
            });
        });
    });
}
exports.shutdownServer = shutdownServer;
function runStandalone(code, serverBinaryPath) {
    const result = cp.spawnSync(serverBinaryPath, [], { input: code, encoding: "utf8" });
    return JSON.parse(result.stdout);
}
exports.runStandalone = runStandalone;
//# sourceMappingURL=shim.js.map