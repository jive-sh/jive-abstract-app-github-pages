import { Effect, FileSystem, Option, Redacted, pipe } from "effect";
import { effunct, implementing, type EffectGen } from "effective-modules";
import { OSPlatform } from "jive-abstract-library";
import { dirname, resolve } from "node:path";
import { PUBLISHING_GIT_DIR } from "../../common/constants";
import { appGithubPagesModules } from "../index";
import type { GitRemote, IPublishingBranch, Publication, PublishInput } from "./interface";

/** The identity GitHub shows for commits made with an Actions job's token. */
const COMMITTER = { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" } as const;

/**
 * Configuration given to every git command through the environment, so a token never appears in a process's
 * arguments and the machine's own git configuration (a signing key, a credential helper, a URL rewrite) never
 * changes what a deploy does.
 */
function gitEnvironment(remote: GitRemote): Record<string, string | undefined> {
  const config = Option.match(remote.token, {
    onNone: () => [],
    // GitHub accepts a job token as basic auth with any username; actions/checkout sends this same header.
    onSome: (token) => [{
      key: `http.${new URL(remote.url).origin}/.extraheader`,
      value: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${Redacted.value(token)}`).toString("base64")}`,
    }],
  });
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: COMMITTER.name,
    GIT_AUTHOR_EMAIL: COMMITTER.email,
    GIT_COMMITTER_NAME: COMMITTER.name,
    GIT_COMMITTER_EMAIL: COMMITTER.email,
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(config.flatMap(({ key, value }, index) => [[`GIT_CONFIG_KEY_${index}`, key], [`GIT_CONFIG_VALUE_${index}`, value]])),
  };
}

export class PublishingBranchImpl extends implementing(appGithubPagesModules.PublishingBranch).uses(OSPlatform, FileSystem.FileSystem)
  implements IPublishingBranch {
  *publish(input: PublishInput): EffectGen<Publication, string> {
    const fs = this.getDependency(FileSystem.FileSystem);
    const gitDir = resolve(PUBLISHING_GIT_DIR);
    const workTree = resolve(input.siteDir);
    const env = gitEnvironment(input.remote);
    const git = (args: ReadonlyArray<string>) => this.git({ repository: { gitDir, workTree, env }, args });
    const ref = `refs/heads/${input.branch}`;

    // A fresh repository every time: the remote branch is the only state, so nothing a previous run left can matter.
    yield* pipe(fs.remove(gitDir, { recursive: true, force: true }), Effect.mapError((e) => `Cannot clear ${gitDir}: ${e.message}`));
    yield* pipe(fs.makeDirectory(dirname(gitDir), { recursive: true }), Effect.mapError((e) => `Cannot create ${dirname(gitDir)}: ${e.message}`));
    yield* git(["init", "--quiet"]);

    const remoteHead = (yield* git(["ls-remote", "--heads", input.remote.url, ref])).trim();
    const parent = remoteHead === "" ? Option.none<string>() : Option.some(remoteHead.split(/\s/)[0]!);
    if (Option.isSome(parent)) {
      yield* git(["fetch", "--quiet", "--depth=1", input.remote.url, ref]);
    }

    // Every file, ignore rules included: the site is exactly what the folder holds.
    yield* git(["add", "--all", "--force", "."]);
    const tree = (yield* git(["write-tree"])).trim();
    if (Option.isSome(parent) && (yield* git(["rev-parse", `${parent.value}^{tree}`])).trim() === tree) {
      yield* Effect.log(`${input.branch} already holds this site, at ${parent.value}`);
      return { commitSha: parent.value, changed: false };
    }

    const commitSha = (yield* git([
      "commit-tree", tree, "--no-gpg-sign", "-m", input.message,
      ...Option.match(parent, { onNone: () => [], onSome: (sha) => ["-p", sha] }),
    ])).trim();
    const pushed = yield* Effect.result(effunct(git)(["push", "--quiet", input.remote.url, `${commitSha}:${ref}`]));
    if (pushed._tag === "Failure") {
      return yield* Effect.fail(pushed.failure.includes("(fetch first)") || pushed.failure.includes("(non-fast-forward)")
        ? `${input.branch} moved while this deploy ran, most likely another deploy publishing first; nothing was overwritten, and rerunning this deploy publishes on top of it. ${pushed.failure}`
        : pushed.failure);
    }
    yield* Effect.log(`Pushed ${commitSha} to ${input.branch}${Option.isSome(parent) ? ` on top of ${parent.value}` : ", its first commit"}`);
    return { commitSha, changed: true };
  }

  /** Runs a git subcommand against the publishing repository and returns its stdout, failing with its stderr on a nonzero exit. */
  private *git(input: {
    readonly repository: { readonly gitDir: string; readonly workTree: string; readonly env: Record<string, string | undefined> };
    readonly args: ReadonlyArray<string>;
  }): EffectGen<string, string> {
    const { gitDir, workTree, env } = input.repository;
    const result = yield* this.dependencies.OSPlatform.spawnProcess({ command: "git", args: ["--git-dir", gitDir, "--work-tree", workTree, ...input.args], env });
    if (result.exitCode !== 0) {
      return yield* Effect.fail(`git ${input.args[0]} exited with code ${result.exitCode}: ${result.stderr.trim()}`);
    }
    return result.stdout;
  }
}
