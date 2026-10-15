// Reapply a saved revision through the public Gateway; no database or fixture access.
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const { values } = parseArgs({
  options: {
    gateway: { type: "string", default: "http://127.0.0.1:8080" },
    project: { type: "string" },
    revision: { type: "string" },
    capture: { type: "string", multiple: true },
    assembly: { type: "string", multiple: true },
    out: { type: "string" },
    "timeout-seconds": { type: "string", default: "600" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "node scripts/apply-interpretation.mjs --project ID --revision ID --capture ID [--capture ID] [--assembly ID (one per capture, same order)] [--gateway URL] [--out NEW_DIRECTORY] [--timeout-seconds 600]",
  );
  process.exit(0);
}
if (
  !values.project ||
  !values.revision ||
  !values.capture?.length ||
  values.capture.length > 100
)
  throw new Error(
    "Required: --project, --revision and 1–100 --capture values. Use --help.",
  );
if (new Set(values.capture).size !== values.capture.length)
  throw new Error("Duplicate capture.");
if (values.assembly && values.assembly.length !== values.capture.length)
  throw new Error("Provide exactly one --assembly per --capture, in the same order.");
const seconds = Number(values["timeout-seconds"]);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 600)
  throw new Error("timeout-seconds must be 5–600.");
const base = new URL(values.gateway);
if (!["http:", "https:"].includes(base.protocol))
  throw new Error("Gateway must be an HTTP(S) URL.");
const signal = AbortSignal.timeout(seconds * 1000);
async function request(path, body) {
  const response = await fetch(new URL(path, base), {
    signal,
    ...(body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 2000)}`);
  // Preserve numeric literals in the exported DTO, including uint64 above 2^53.
  return JSON.parse(text, (_key, value, context) =>
    typeof value === "number" ? JSON.rawJSON(context.source) : value,
  );
}
const projectPath = "/api/v1/projects/" + encodeURIComponent(values.project);
const corpus = [];
let settingsVersion;
for (const [index, captureId] of values.capture.entries()) {
  const page = await request(
    `${projectPath}/captures/${encodeURIComponent(captureId)}/assemblies`,
  );
  const assembly = values.assembly
    ? page.items.find((item) => item.assemblyId === values.assembly[index] && item.status === "READY")
    : [...page.items].reverse().find((item) => item.status === "READY");
  if (!assembly) throw new Error(`No READY assembly for ${captureId}.`);
  settingsVersion ??= assembly.settingsVersion;
  if (settingsVersion !== assembly.settingsVersion)
    throw new Error(
      "Assemblies use different settings. Rebuild the selected captures with the same settings.",
    );
  corpus.push({ captureId, assemblyId: assembly.assemblyId });
}
const started = performance.now();
const created = await request(projectPath + "/runs", {
  revisionId: values.revision,
  settingsVersion,
  corpus,
  filters: { scope: "all" },
});
for (;;) {
  const job = await request(
    "/api/v1/jobs/" +
      encodeURIComponent(created.jobId) +
      "?projectId=" +
      encodeURIComponent(values.project),
  );
  if (job.status === "SUCCEEDED") break;
  if (["FAILED", "CANCELLED", "INTERRUPTED"].includes(job.status))
    throw new Error(JSON.stringify(job));
  await delay(500, undefined, { signal });
}
const run = await request(
  projectPath + "/runs/" + encodeURIComponent(created.runId),
);
const directory = resolve(values.out ?? "output/reapply-" + created.runId);
await mkdir(dirname(directory), { recursive: true });
await mkdir(directory, { recursive: false }); // Existing output is never overwritten.
await writeFile(resolve(directory, "run.json"), JSON.stringify(run, null, 2), {
  flag: "wx",
});
const results = await open(resolve(directory, "results.ndjson"), "wx");
let cursor = "",
  count = 0;
const seen = new Set();
try {
  for (let index = 0; ; index++) {
    if (index >= 10000)
      throw new Error(
        "Result page safety limit exceeded; output is incomplete.",
      );
    const page = await request(
      projectPath +
        "/runs/" +
        encodeURIComponent(created.runId) +
        "/results?view=messages&limit=100&cursor=" +
        encodeURIComponent(cursor),
    );
    for (const item of page.items) {
      await results.write(JSON.stringify(item) + "\n");
      count++;
    }
    if (!page.nextCursor) break;
    if (seen.has(page.nextCursor))
      throw new Error("Repeated result cursor; output is incomplete.");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
} finally {
  await results.close();
}
console.log(
  JSON.stringify(
    {
      runId: run.runId,
      results: count,
      seconds: (performance.now() - started) / 1000,
      directory,
      summary: run.summary,
    },
    null,
    2,
  ),
);
