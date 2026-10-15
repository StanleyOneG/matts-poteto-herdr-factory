// Fixed IPC gate only: the authorized Bash, not this helper, executes the native command.
import { connect } from "node:net";
const [endpoint, binding] = process.argv.slice(2);
if (!endpoint?.startsWith("legion-cleanup-") || !binding) process.exit(1);
const socket = connect({ path: `\0${endpoint}` });
let response = "";
socket.once("connect", () => socket.write(`${binding}\n`));
socket.on("data", chunk => { response += chunk; });
socket.once("error", () => { process.exitCode = 1; });
socket.once("close", () => { process.exitCode = response === "go\n" ? 0 : 1; });
