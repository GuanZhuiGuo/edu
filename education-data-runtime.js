import { createEducationDataStore } from "./education-data-store.js";
import { EDUCATION_DEMO_TENANT_ID, seedEducationDemoData } from "./education-data-seed.js";

/** Creates the local application database and seeds it once with rebuildable assets. */
export function createEducationDataRuntime({ env = process.env, storeOptions = {} } = {}) {
  const store = createEducationDataStore({
    filename: env.EDUCATION_DATA_DB_PATH || undefined,
    ...storeOptions
  });
  const migration = store.initialize();
  const tenantId = String(env.EDUCATION_DATA_TENANT_ID || EDUCATION_DEMO_TENANT_ID).trim();
  const seed = String(env.EDUCATION_DATA_SEED_DEMO || "true").trim().toLowerCase() !== "false"
    ? seedEducationDemoData({ store, tenantId })
    : null;
  return Object.freeze({ store, tenantId, migration, seed });
}
