import { readFileSync, writeFileSync } from "node:fs";
import { publish } from "../src/private-evidence.js";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("Owned context fixture paths required");
if (process.argv[4] === "raw") writeFileSync(destination, readFileSync(source), { mode: 0o600 });
else publish(destination, JSON.parse(readFileSync(source, "utf8")));
