import { exerciseRace } from "../tests/support/composed-transport.mjs";
for (const stage of ["intake", "workspace", "engineering"]) {
  for (const outcome of ["admitted", "pending", "stale", "auth-unavailable", "send-uncertain"]) {
    const observation = await exerciseRace("census", { stage, outcome });
    console.log(JSON.stringify(observation));
  }
}
