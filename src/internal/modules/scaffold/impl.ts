import { Effect, FileSystem, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import { OSPlatform } from "jive-abstract-library";
import { dirname, join } from "node:path";
import { scaffoldFiles } from "../../public/scaffold";
import { appGithubPagesModules } from "../index";
import type { CreateInput, IScaffold } from "./interface";

export class ScaffoldImpl extends implementing(appGithubPagesModules.Scaffold).uses(OSPlatform, FileSystem.FileSystem) implements IScaffold {
  *create(input: CreateInput): EffectGen<ReadonlyArray<string>, string> {
    const fs = this.getDependency(FileSystem.FileSystem);
    const { directory } = input;
    const exists = yield* pipe(fs.exists(directory), Effect.mapError((e) => `Cannot check for ${directory}: ${e.message}`));
    if (exists) {
      const entries = yield* pipe(fs.readDirectory(directory), Effect.mapError((e) => `Cannot read ${directory}: ${e.message}`));
      if (entries.length > 0) return yield* Effect.fail(`${directory} is not empty; create a package in a new or empty directory`);
    }

    const files = scaffoldFiles(input.scaffold);
    for (const [path, text] of Object.entries(files)) {
      const target = join(directory, path);
      yield* pipe(
        fs.makeDirectory(dirname(target), { recursive: true }),
        Effect.andThen(fs.writeFileString(target, text)),
        Effect.mapError((e) => `Cannot write ${target}: ${e.message}`),
      );
    }

    if (input.install) {
      yield* Effect.log(`Installing ${input.scaffold.packageName}'s dependencies`);
      const { exitCode } = yield* this.dependencies.OSPlatform.spawnProcess({
        command: "bun",
        args: ["install"],
        cwd: directory,
        stdout: "inherit",
        stderr: "inherit",
      });
      if (exitCode !== 0) return yield* Effect.fail(`bun install in ${directory} exited with code ${exitCode}; the files are written`);
    }
    return Object.keys(files);
  }
}
