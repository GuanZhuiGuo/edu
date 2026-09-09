import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverUrl = new URL("../server.js", import.meta.url);
const piHttpUrl = new URL("../pi-learning-http.js", import.meta.url);
const envExampleUrl = new URL("../.env.example", import.meta.url);

test("external Marketing Agent HTTP integration remains disabled", async () => {
  const [serverSource, piHttpSource, envExample] = await Promise.all([
    readFile(serverUrl, "utf8"),
    readFile(piHttpUrl, "utf8"),
    readFile(envExampleUrl, "utf8"),
  ]);

  assert.doesNotMatch(serverSource, /marketing-agent-client/u);
  assert.doesNotMatch(serverSource, /handleMarketingAgentChat/u);
  assert.doesNotMatch(serverSource, /MARKETING_AGENT_/u);
  assert.doesNotMatch(envExample, /MARKETING_/u);

  assert.match(serverSource, /createPiLearningHttpHandler/u);
  assert.match(serverSource, /handlePiLearningHttp\(req, res, requestUrl\)/u);
  assert.match(piHttpSource, /\/api\/agent\/chat\/stream/u);
});
