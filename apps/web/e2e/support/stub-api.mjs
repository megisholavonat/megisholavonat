// The API as the Next server sees it in e2e (API_URL): run summaries from
// fixtures/runs for the delay card pages, 404 for unknown runs, and 503 for
// everything else, so other server-side lookups fall back as without an API.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const PORT = Number(process.env.STUB_API_PORT ?? 3211);
const RUNS = join(import.meta.dirname, "..", "fixtures", "runs");

createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://stub");
    const run = url.pathname.match(
        /^\/v1\/history\/runs\/([0-9A-Za-z]+)\/(\d{4}-\d{2}-\d{2})$/,
    );
    if (url.pathname === "/") {
        response.writeHead(200).end("ok");
        return;
    }
    if (!run) {
        response.writeHead(503).end();
        return;
    }
    try {
        const body = await readFile(join(RUNS, `${run[1]}-${run[2]}.json`));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(body);
    } catch {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "Run not found" }));
    }
}).listen(PORT, "127.0.0.1");
