import { createEducationDataRuntime } from "../education-data-runtime.js";

const runtime = createEducationDataRuntime();
try {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    database: runtime.store.filename,
    migration: runtime.migration,
    seed: runtime.seed,
    summary: runtime.store.summary({ tenantId: runtime.tenantId })
  }, null, 2)}\n`);
} finally {
  runtime.store.close();
}
