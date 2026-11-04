import { Effect, Option, pipe } from "effect";
import { effunct } from "effective-modules";
import { Cli } from "jive-abstract-library";
import { basename, resolve } from "node:path";
import { version } from "../../../package.json";
import { layerLive } from "../common/layer";
import { appGithubPagesModules } from "../modules";

const USAGE = "usage: jive-app-github-pages create <directory> [--name <package>] [--domain <hostname>] [--skip-install]";

/** `jive-app-github-pages create <directory>`: scaffolds a new package extending this abstract. */
export const create = Cli.command({
  description: "create a new static site package served by GitHub Pages",
  flags: {
    name: Cli.flag.string({ description: "the package's npm name (default: the directory's name)" }),
    domain: Cli.flag.string({ description: 'the custom domain to serve it at, e.g. "docs.example.com" (default: none, served at <owner>.github.io/<repository>)' }),
    "skip-install": Cli.flag.boolean({ description: "only write the files; skip bun install" }),
  },
  *run({ flags, args }) {
    const directoryArg = args[0];
    if (directoryArg === undefined || args.length > 1) {
      return yield* Effect.andThen(Effect.logError(USAGE), Effect.fail(new Cli.CliError({ message: USAGE, exitCode: 2 })));
    }
    const directory = resolve(directoryArg);
    const scaffold = { packageName: Option.getOrElse(flags.name, () => basename(directory)), domain: flags.domain, abstractVersion: version };
    yield* pipe(
      effunct(function* () {
        const written = yield* (yield* appGithubPagesModules.Scaffold).create({ directory, scaffold, install: !flags["skip-install"] });
        yield* Effect.log(`Wrote ${written.length} files into ${directory}:\n  ${written.join("\n  ")}`);
      })(),
      Effect.provide(layerLive),
      // Cli.run leaves printing a command's own failure to the command, as the hooks do.
      Effect.catch((failure: string) => Effect.andThen(Effect.logError(`✗ ${failure}`), Effect.fail(new Cli.CliError({ message: failure, exitCode: 1 })))),
    );
  },
});
