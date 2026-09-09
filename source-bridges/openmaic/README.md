# OpenMAIC official-source bridge

This bridge runs the pinned upstream OpenMAIC generation source instead of
constructing a local imitation.

## Public API

```js
import { runOpenMaicOfficialPipeline } from "./index.js";

const result = await runOpenMaicOfficialPipeline(
  {
    source_id: "lesson-1",
    title: "牛顿第二定律",
    language: "zh-CN",
    source_text: "..."
  },
  {
    aiCall: async (systemPrompt, userPrompt, images) => {
      // Call the host application's already-configured model client.
      // Resolve to the model response text.
    }
  }
);
```

The result is:

```text
{
  session,   // official GenerationSession
  outlines,  // official SceneOutline[]
  stage,     // official Stage
  scenes,    // official Scene[]
  actions,   // unmodified flattening of scenes[].actions
  execution,
  provenance
}
```

No compact card schema and no A2UI projection is produced. A slide is rendered
from `scene.content.canvas`; a quiz is read from
`scene.content.questions`; playback uses `scene.actions`.

The worker receives prompts and returns model text over JSONL. Model
credentials remain in the host process and credential-like environment
variables are removed before starting the worker.

The host Ark adapter keeps JSON mode for the official outline, slide, quiz and
action prompts. It switches to raw text only when an official OpenMAIC system
prompt explicitly requests a complete HTML document, so interactive Scene HTML
is not forced through a JSON parser.

The upstream root package does not declare ESM while its
`@openmaic/dsl` dependency is ESM-only. Direct execution therefore fails in
Node before generation starts. The compatibility build keeps the upstream tree
untouched and uses the esbuild version already locked by OpenMAIC:

```sh
node source-bridges/openmaic/build-official-worker.mjs
```

It bundles `official-worker.ts` plus the imported official generation source as
`generated/official-worker.mjs`; the accompanying metafile records every source
input in the bundle.

## Official renderer

The pinned checkout includes `@openmaic/renderer@0.0.2`. After its official
workspace build, browser bundlers can import:

```js
import { SlideCanvas } from "./renderer-entry.js";
```

or use the upstream entry directly:

```js
import { SlideCanvas } from
  "../../third_party/openmaic/packages/@openmaic/renderer/dist/index.js";
```

Pass `scene.content.canvas` to `<SlideCanvas slide={...} />`. The renderer is a
React read-only canvas and requires its documented peer dependencies and a
parent with a defined width and height.

## Deliberate boundary and limitations

- The invoked public entry is OpenMAIC's
  `lib/generation/generation-pipeline.ts#runGenerationPipeline`. Slide, quiz and
  interactive generation use the injected native `AICallFn`.
- That entry does not accept the AI SDK `LanguageModel` object required by
  OpenMAIC's PBL planner. A model-produced PBL-only outline therefore cannot
  produce a scene through this bridge; the bridge fails instead of fabricating
  a replacement.
- OpenMAIC's server-only extras (web research, generated media, TTS, agent
  profile generation, persistence and hosted classroom URL) are intentionally
  not invoked. They depend on OpenMAIC's own server configuration and storage,
  not just the host `aiCall`.
- The in-memory `StageStore` is a compatibility wrapper copied in shape from
  `lib/server/classroom-generation.ts#createInMemoryStore`. It holds the native
  Stage/Scene values but contains no generation logic.
- `@openmaic/renderer` is React/Tailwind-based. Its optional `fonts.css` points
  to OpenMAIC's external font CDN; without it, the browser uses local fallback
  fonts.

## Source and license

The checkout is pinned to
`fcdb6d62b380c066de2a4733910669c9e697b83a`. That revision and the reused
packages are MIT licensed; the complete upstream `LICENSE` remains at
`third_party/openmaic/LICENSE`. The bridge does not patch upstream source.
