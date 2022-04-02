import { UUID, runStandalone, DEFAULT_SERVER_BINARY_IN_PATH } from "./shim";

import type { TwoSlashOptions, TwoSlashReturn } from "@typescript/twoslash";
import { createSyncFn } from "synckit";

export { UUID, startServer, shutdownServer } from "./shim";

export type TwoSlashRustOptions = TwoSlashOptions & {
  twoslashRustServerId?: UUID;
  twoslashServerBinaryPath?: string;
};

const runAsServerWorkerPath = require.resolve("./run_as_server_worker");

export function twoslasher(
  code: string,
  _extension: string,
  options: TwoSlashRustOptions = {}
): TwoSlashReturn {
  const serverId = options.twoslashRustServerId;
  const serverBinaryPath = options.twoslashServerBinaryPath ?? DEFAULT_SERVER_BINARY_IN_PATH;
  if (serverId) {
    // As much as I wish we didn't have to do this, I can't think of a better
    // way. The reason is that consumers want a sync version of `twoslasher`.
    // Hopefully this won't hang the thread... unfortunately, we don't always
    // know that it won't.
    const runAsServer = createSyncFn(runAsServerWorkerPath);
    return runAsServer(code, serverId);
  }

  return runStandalone(code, serverBinaryPath);
}
