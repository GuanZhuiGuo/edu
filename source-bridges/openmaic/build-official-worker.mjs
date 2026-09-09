import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const bridgeDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(bridgeDirectory, "../..");
const openMaicDirectory = path.join(
  projectDirectory,
  "third_party",
  "openmaic"
);
const outputDirectory = path.join(bridgeDirectory, "generated");
const outputFile = path.join(outputDirectory, "official-worker.mjs");
const metadataFile = path.join(
  outputDirectory,
  "official-worker.meta.json"
);
const requireFromOpenMaic = createRequire(import.meta.url);
const { build } = requireFromOpenMaic(
  path.join(
    openMaicDirectory,
    "node_modules",
    ".pnpm",
    "esbuild@0.27.7",
    "node_modules",
    "esbuild"
  )
);

await mkdir(outputDirectory, { recursive: true });

const result = await build({
  entryPoints: [path.join(bridgeDirectory, "official-worker.ts")],
  outfile: outputFile,
  absWorkingDir: openMaicDirectory,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: "import { createRequire as __openmaicCreateRequire } from 'node:module'; const require = __openmaicCreateRequire(import.meta.url);"
  },
  sourcemap: false,
  metafile: true,
  legalComments: "eof",
  logLevel: "info",
  plugins: [
    {
      name: "openmaic-tsconfig-paths",
      setup(buildContext) {
        buildContext.onResolve({ filter: /^@\// }, (args) =>
          buildContext.resolve(
            path.join(openMaicDirectory, args.path.slice(2)),
            {
              kind: args.kind,
              resolveDir: openMaicDirectory
            }
          )
        );
      }
    }
  ]
});

const metadata = {
  generated_at: new Date().toISOString(),
  upstream_revision:
    "fcdb6d62b380c066de2a4733910669c9e697b83a",
  entrypoint: "source-bridges/openmaic/official-worker.ts",
  official_generation_entry:
    "third_party/openmaic/lib/generation/generation-pipeline.ts",
  format: "esm",
  platform: "node",
  upstream_source_modified: false,
  esbuild_metafile: result.metafile
};

await writeFile(
  metadataFile,
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8"
);
