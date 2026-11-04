import { Effect } from "effect";
import { Cli, runDevServer } from "jive-abstract-library";
import { PackageJsonSchema } from "../public/manifest";

/** `jive-app-github-pages dev`: keeps the package's package.schema.json current while its package.json is edited. */
export const dev = Cli.command({
  description: "watch this package and keep its generated package.schema.json current while you work",
  *run() {
    yield* Effect.promise(() => runDevServer({ genPackageJsonSchema: Effect.succeed(PackageJsonSchema), watchPaths: ["package.json"] }));
  },
});
