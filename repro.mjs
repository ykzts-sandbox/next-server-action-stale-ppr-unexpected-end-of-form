// Starts `next start`, waits until the prerendered `/` is stale, posts the
// Server Action on that page the way the browser does, and reports what the
// server logged. Run `npm run build` first.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const port = process.env.PORT ?? "3000";
const origin = `http://localhost:${port}`;

const manifest = JSON.parse(
  readFileSync(".next/server/server-reference-manifest.json", "utf8")
);
const [actionId] = Object.entries(manifest.node).find(
  ([, entry]) => entry.exportedName === "submit"
);

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", port],
  {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  }
);
let log = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    log += chunk;
    process.stdout.write(`[next] ${chunk}`);
  });
}

const postAction = async () => {
  // What `useActionState` sends: the previous state and the form's fields,
  // encoded by React as multipart form data.
  const body = new FormData();
  body.append("_1_name", "hello");
  body.append("0", JSON.stringify(["", "$K1"]));
  const response = await fetch(origin, {
    body,
    headers: { accept: "text/x-component", "next-action": actionId },
    method: "POST",
  });
  const text = await response.text();
  if (process.env.DEBUG) console.log(text.slice(0, 400));
  return { status: response.status, ok: text.includes("Received hello") };
};

try {
  for (let i = 0; ; i++) {
    try {
      await fetch(`${origin}/_next/static/not-found`);
      break;
    } catch {
      if (i > 100) throw new Error("next start did not come up");
      await sleep(100);
    }
  }

  // The prerendered entry revalidates after one second.
  await sleep(2000);

  for (let i = 1; i <= 3; i++) {
    const result = await postAction();
    console.log(`action #${i}: HTTP ${result.status}, action result returned: ${result.ok}`);
    await sleep(500);
  }
  await sleep(1000);
} finally {
  server.kill();
}

const reproduced = log.includes("Unexpected end of form");
console.log(
  reproduced
    ? "\nREPRODUCED: the server logged `Error: Unexpected end of form` for a Server Action that succeeded."
    : "\nNot reproduced: no `Unexpected end of form` in the server log."
);
process.exitCode = reproduced ? 1 : 0;
