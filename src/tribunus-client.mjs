import { connect } from "node:net";
import { readFileSync } from "node:fs";
const [descriptorPath, endpoint, requestPath] = process.argv.slice(2);
try {
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const socket = connect(endpoint);
  let buffer = "";
  socket.on("connect", () => socket.write(JSON.stringify({ ...request, capability: descriptor.capability }) + "\n"));
  socket.on("data", (chunk) => {
    buffer += chunk;
    const end = buffer.indexOf("\n");
    if (end < 0) return;
    process.stdout.write(buffer.slice(0, end));
    socket.end();
  });
  socket.on("error", (error) => { process.stderr.write(`Managed control connection failed. ${error.code ?? "socket-error"}`); process.exitCode = 1; });
} catch {
  process.stderr.write("Managed control metadata is unavailable. Preserve the private descriptor and request.");
  process.exitCode = 1;
}
