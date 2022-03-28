import * as cp from "child_process";
import * as fs from "fs";
import * as net from "net";
import { Readable, Writable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { lock } from "proper-lockfile";

import type { TwoSlashReturn } from "@typescript/twoslash";

const RUST_TWOSLASH_BIN = "rust-twoslash";

const SERVER_TABLE_FILE = "/tmp/twoslash-rust-servers.json";

export type UUID = string & { _brand: "uuid" };
export type Address = string & { _brand: "address" };

export type Server = {
  uuid: UUID;
};

type ServerTable = Record<UUID, Address>;

function readServerTable(): ServerTable {
  const table = fs.readFileSync(SERVER_TABLE_FILE, "utf8");
  return JSON.parse(table);
}

function commitServerTable(table: ServerTable) {
  fs.writeFileSync(SERVER_TABLE_FILE, JSON.stringify(table));
}

async function lockTable<T>(go: () => Promise<T>): Promise<T> {
  if (!fs.existsSync(SERVER_TABLE_FILE)) {
    // Ensure the table exists. NB: possible race here, but I don't think it's a
    // big deal.
    fs.writeFileSync(SERVER_TABLE_FILE, JSON.stringify({}));
  }
  const release = await lock(SERVER_TABLE_FILE);
  const result = await go();
  await release();
  return result;
}

async function addServer(uuid: UUID, address: Address) {
  return lockTable(async () => {
    const table = readServerTable();
    table[uuid] = address;
    commitServerTable(table);
  });
}

async function removeServer(uuid: UUID) {
  return lockTable(async () => {
    const table = readServerTable();
    delete table[uuid];
    commitServerTable(table);
  });
}

async function getServer(uuid: UUID): Promise<[string, number]> {
  return lockTable(async () => {
    const table = readServerTable();
    const addr = table[uuid];
    const [host, port] = addr.split(":");
    return [host, Number(port)];
  });
}

export async function startServer(useCargo: boolean = false, projectName?: string): Promise<Server> {
  const uuid = uuidv4() as UUID;

  const env: Record<string, string> = {
    ...process.env,
    TWOSLASH_SERVER_UUID: uuid,
    TWOSLASH_USE_CARGO: useCargo ? "1" : "0",
  };
  if (projectName) {
    env.TWOSLASH_PROJECT_NAME = projectName;
  }

  const child = cp.spawn(RUST_TWOSLASH_BIN, [], {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });

  const server_address = await new Promise<Address>((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", (e) => {
      stdout += e.toString("utf8");
      if (stdout.includes("\n")) {
        child.stdout.destroy();
        resolve(stdout.trim() as Address);
      }
    });
    child.on("exit", () => reject());
  });

  await addServer(uuid, server_address);

  child.unref();

  return { uuid };
}

function protocolWrite(stream: Writable, data: string) {
  const buffer = Buffer.from(data, "binary");
  const protoBuffer = Buffer.alloc(4 + buffer.length);
  protoBuffer.writeUInt32BE(buffer.length);
  buffer.copy(protoBuffer, 4);
  stream.write(protoBuffer);
}

async function protocolRead(stream: Readable): Promise<string> {
  return new Promise<string>((resolve) => {
    let buffer = Buffer.from("");
    let messageSize: number | undefined;
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
}

export async function runWithServer(code: string, serverId: UUID): Promise<TwoSlashReturn> {
  const [host, port] = await getServer(serverId);
  const client = new net.Socket();
  client.connect(port, host, () => {
    protocolWrite(client, code);
  });

  return protocolRead(client).then((data) => {
    client.destroy();
    return JSON.parse(data);
  });
}

export async function shutdownServer(serverId: UUID) {
  const [host, port] = await getServer(serverId);
  const client = new net.Socket();

  return new Promise((resolve) => {
    client.connect(port, host, () => {
      protocolWrite(client, `Shutdown ${serverId}`);
      client.destroy();
      removeServer(serverId).then(resolve);
    });
  });
}

export function runStandalone(code: string): TwoSlashReturn {
  const result = cp.spawnSync(RUST_TWOSLASH_BIN, [], { input: code, encoding: "utf8" });

  return JSON.parse(result.stdout);
}
