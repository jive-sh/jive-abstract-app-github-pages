import { Effect, FileSystem, Option, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import { OSPlatform } from "jive-abstract-library";
import { join } from "node:path";
import { SITE_FILES, SITE_INDEX_FILE } from "../../common/constants";
import { ABSTRACT_KEY, type AppGithubPagesConfig } from "../../public/manifest";
import { appGithubPagesModules } from "../index";
import type { ISite } from "./interface";

export class SiteImpl extends implementing(appGithubPagesModules.Site).uses(OSPlatform, FileSystem.FileSystem) implements ISite {
  *build(config: AppGithubPagesConfig): EffectGen<void, string> {
    yield* Effect.log(`Building the site: bun run ${config.buildScript}`);
    const { exitCode } = yield* this.dependencies.OSPlatform.spawnProcess({
      command: "bun",
      args: ["run", config.buildScript],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (exitCode !== 0) return yield* Effect.fail(`bun run ${config.buildScript} exited with code ${exitCode}`);

    const index = join(config.outputDir, SITE_INDEX_FILE);
    if (!(yield* this.exists(index))) {
      return yield* Effect.fail(`bun run ${config.buildScript} wrote no ${index}, which GitHub Pages serves at the site's root; is jive.${ABSTRACT_KEY}.outputDir "${config.outputDir}" where it writes the site?`);
    }

    const cname = join(config.outputDir, SITE_FILES.customDomain);
    const existing = yield* this.readIfExists(cname);
    if (Option.isSome(config.domain)) {
      if (Option.isSome(existing) && existing.value.trim() !== config.domain.value) {
        yield* Effect.logWarning(`${cname} named "${existing.value.trim()}"; replaced with jive.${ABSTRACT_KEY}.domain, "${config.domain.value}"`);
      }
      yield* this.write(cname, `${config.domain.value}\n`);
    } else if (Option.isSome(existing)) {
      yield* Effect.logWarning(`Removed ${cname}, which named "${existing.value.trim()}": jive.${ABSTRACT_KEY}.domain is null, so the site is served without a custom domain`);
      yield* pipe(this.getDependency(FileSystem.FileSystem).remove(cname), Effect.mapError((e) => `Cannot remove ${cname}: ${e.message}`));
    }
    yield* this.write(join(config.outputDir, SITE_FILES.disableJekyll), "");
    yield* Effect.log(`Built the site into ${config.outputDir}${Option.isSome(config.domain) ? `, for ${config.domain.value}` : ""}`);
  }

  *check(config: AppGithubPagesConfig): EffectGen<void, string> {
    const problems: Array<string> = [];
    for (const file of [SITE_INDEX_FILE, SITE_FILES.disableJekyll]) {
      const path = join(config.outputDir, file);
      if (!(yield* this.exists(path))) problems.push(`${path} is missing`);
    }
    const cname = join(config.outputDir, SITE_FILES.customDomain);
    const existing = yield* this.readIfExists(cname);
    if (Option.isSome(config.domain) && Option.getOrUndefined(existing)?.trim() !== config.domain.value) {
      problems.push(Option.isSome(existing)
        ? `${cname} names "${existing.value.trim()}", not jive.${ABSTRACT_KEY}.domain "${config.domain.value}"`
        : `${cname} is missing, so GitHub Pages would not serve the site at ${config.domain.value}`);
    }
    if (Option.isNone(config.domain) && Option.isSome(existing)) {
      problems.push(`${cname} names "${existing.value.trim()}", but jive.${ABSTRACT_KEY}.domain is null`);
    }
    if (problems.length > 0) {
      return yield* Effect.fail(`${config.outputDir} is not a site ready to publish; run jive:cicd:build:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    }
  }

  private *exists(path: string): EffectGen<boolean, string> {
    return yield* pipe(this.getDependency(FileSystem.FileSystem).exists(path), Effect.mapError((e) => `Cannot check for ${path}: ${e.message}`));
  }

  private *readIfExists(path: string): EffectGen<Option.Option<string>, string> {
    if (!(yield* this.exists(path))) return Option.none();
    return Option.some(yield* pipe(this.getDependency(FileSystem.FileSystem).readFileString(path), Effect.mapError((e) => `Cannot read ${path}: ${e.message}`)));
  }

  private *write(path: string, text: string): EffectGen<void, string> {
    yield* pipe(this.getDependency(FileSystem.FileSystem).writeFileString(path, text), Effect.mapError((e) => `Cannot write ${path}: ${e.message}`));
  }
}
