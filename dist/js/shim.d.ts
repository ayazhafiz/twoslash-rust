import type { TwoSlashReturn } from "@typescript/twoslash";
export declare const DEFAULT_SERVER_BINARY_IN_PATH = "rust-twoslash";
export declare type UUID = string & {
    _brand: "uuid";
};
export declare type Address = string & {
    _brand: "address";
};
export declare type Server = {
    uuid: UUID;
};
export declare function startServer(useCargo?: boolean, projectName?: string, serverBinaryPath?: string): Promise<Server>;
export declare function runWithServer(code: string, serverId: UUID): Promise<TwoSlashReturn>;
export declare function shutdownServer(serverId: UUID): Promise<unknown>;
export declare function runStandalone(code: string, serverBinaryPath: string): TwoSlashReturn;
