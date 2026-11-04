import { Option } from "effect";
import { REQUIRED_SCRIPTS } from "jive-abstract-library";
import { ABSTRACT_PACKAGE_NAME, CLI_CMD_NAME } from "../common/constants";
import { ABSTRACT_KEY, GITHUB_TOKEN_SECRET } from "./manifest";

/** What a new package is scaffolded from. */
export interface ScaffoldInput {
  /** The new package's npm name, e.g. "@acme/docs". */
  readonly packageName: string;
  /** The custom domain to serve it at, e.g. "docs.example.com"; none for `<owner>.github.io/<repository>`. */
  readonly domain: Option.Option<string>;
  /** The version of this abstract the package starts on, as a dev dependency. */
  readonly abstractVersion: string;
}

/** Files to write, by path relative to the package root. */
export type ScaffoldFiles = Readonly<Record<string, string>>;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lines(...text: ReadonlyArray<string>): string {
  return `${text.join("\n")}\n`;
}

/** The hook each `jive:cicd:*` script runs: the script's name after the prefix, with `deploy:plan` as `deploy-plan`. */
function hookCommand(script: (typeof REQUIRED_SCRIPTS)[number]): string {
  return `${CLI_CMD_NAME} cicd ${script.slice("jive:cicd:".length).replace(":", "-")}`;
}

/**
 * The deploy job's token needs `contents: write` to push the publishing branch and `pages: write` to request its
 * build, and the caller workflow is what grants a job's token its permissions.
 */
const PIPELINE_YML = lines(
  "name: CI/CD Pipeline",
  "",
  "concurrency:",
  "  group: ${{ github.workflow }}-${{ github.ref }}",
  "  cancel-in-progress: true",
  "",
  "on:",
  "  pull_request:",
  "  push:",
  "  workflow_dispatch:",
  "",
  "# A reusable workflow can only reduce the caller's permissions, never raise them. The deploy pushes the site to",
  "# the gh-pages branch (contents: write) and requests its GitHub Pages build (pages: write) with the job's token.",
  "permissions:",
  "  contents: write",
  "  pages: write",
  "  id-token: write",
  "",
  "jobs:",
  "  pipeline:",
  "    name: Pipeline",
  "    uses: jive-sh/jive/.github/workflows/reusable-pipeline.yml@main",
  "    secrets: inherit",
);

const GITIGNORE = lines("node_modules", "dist", ".DS_Store", "package.schema.json");

function indexHtml(input: ScaffoldInput): string {
  return lines(
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${input.packageName}</title>`,
    "  </head>",
    "  <body>",
    `    <h1>${input.packageName}</h1>`,
    "  </body>",
    "</html>",
  );
}

function readme(input: ScaffoldInput): string {
  const served = Option.match(input.domain, {
    onNone: () => "at `https://<owner>.github.io/<repository>/`",
    onSome: (domain) => `at \`${domain}\`, once its DNS record points at GitHub Pages`,
  });
  return lines(
    `# ${input.packageName}`,
    "",
    `A static site served by GitHub Pages ${served}. It extends \`${ABSTRACT_PACKAGE_NAME}\`, whose \`${CLI_CMD_NAME}\``,
    "CLI builds it and, on every push to `main`, publishes it to the `gh-pages` branch and has GitHub Pages build it.",
    "",
    "- `src/index.html` is the site; `bun run build` bundles it into `dist/` with Bun's HTML bundler. Replace the",
    `  \`build\` script with any generator that writes the site into \`jive.${ABSTRACT_KEY}.outputDir\`.`,
    `- \`bun run dev\` keeps \`package.schema.json\` current, so your editor checks the \`jive\` block in package.json.`,
    "- The repository's GitHub Pages source must be the `gh-pages` branch at `/`; the first deploy says so if it is not.",
  );
}

/** Every file a new GitHub Pages package starts with. */
export function scaffoldFiles(input: ScaffoldInput): ScaffoldFiles {
  return {
    "package.json": json({
      $schema: "./package.schema.json",
      name: input.packageName,
      version: "0.1.0",
      license: "MIT",
      type: "module",
      scripts: {
        ...Object.fromEntries(REQUIRED_SCRIPTS.map((script) => [script, hookCommand(script)])),
        build: "bun build ./src/index.html --outdir dist",
        dev: `${CLI_CMD_NAME} dev`,
      },
      devDependencies: { [ABSTRACT_PACKAGE_NAME]: `^${input.abstractVersion}` },
      jive: {
        cicd: {
          deploy: { verb: "Deploy to", branches: { main: ["Production"] }, previews: false, sequentially: true },
          runsOnPullRequests: true,
          runsOn: "ubuntu-latest",
          requiredSecrets: [GITHUB_TOKEN_SECRET],
        },
        [ABSTRACT_KEY]: { buildScript: "build", outputDir: "dist", domain: Option.getOrNull(input.domain) },
      },
    }),
    ".gitignore": GITIGNORE,
    ".github/workflows/pipeline.yml": PIPELINE_YML,
    "src/index.html": indexHtml(input),
    "README.md": readme(input),
  };
}
