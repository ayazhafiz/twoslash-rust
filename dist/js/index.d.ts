import { UUID } from "./shim";
import type { TwoSlashOptions, TwoSlashReturn } from "@typescript/twoslash";
export { UUID, startServer, shutdownServer } from "./shim";
export declare type TwoSlashRustOptions = TwoSlashOptions & {
    twoslashRustServerId?: UUID;
    twoslashServerBinaryPath?: string;
};
export declare function twoslasher(code: string, _extension: string, options?: TwoSlashRustOptions): TwoSlashReturn;
