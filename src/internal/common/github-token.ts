import { Effect, Redacted } from "effect";
import type { EffectGen } from "effective-modules";
import { GITHUB_TOKEN_SECRET } from "../public/manifest";

/**
 * The job's GitHub token, which the pipeline exports into the environment because the package lists it in
 * `cicd.requiredSecrets`. Read once, at the hook's boundary, and passed on as a `Redacted` value so it never
 * reaches a log.
 */
export function* readGithubToken(): EffectGen<Redacted.Redacted<string>, string> {
  const token = process.env[GITHUB_TOKEN_SECRET];
  if (token === undefined || token === "") {
    return yield* Effect.fail(
      `${GITHUB_TOKEN_SECRET} is not set. Jive's pipeline exports it for this hook when package.json lists it in `
      + `jive.cicd.requiredSecrets; to run the deploy by hand, set it to a token that can push to the repository and request its Pages build`,
    );
  }
  return Redacted.make(token);
}
