import { runAsWorker } from "synckit";
import { runWithServer } from "./shim";

runAsWorker((code, serverId) => runWithServer(code, serverId));
