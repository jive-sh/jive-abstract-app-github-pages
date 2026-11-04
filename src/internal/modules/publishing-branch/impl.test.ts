import { afterAll, beforeAll, describe, expect, test as buntest } from "bun:test";
import { Effect, Layer, Option, Redacted, pipe } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { effunct, type EffectGen } from "effective-modules";
import { OSPlatform, OSPlatformImpl, type ProcessResult, type SpawnProcessInput } from "jive-abstract-library";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppGithubPagesModules, appGithubPagesModules } from "../index";
import { PublishingBranchImpl } from "./impl";
import type { PublishInput } from "./interface";

/**
 * PublishingBranchImpl with real git, against a bare repository on disk standing in for GitHub. Everything lives
 * under node_modules/.cache, so nothing outside this package is touched.
 */

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const root = resolve("node_modules/.cache/publishing-branch-test");
const remote = join(root, "remote.git");
const site = join(root, "site");

function git(args: ReadonlyArray<string>): string {
  const result = Bun.spawnSync(["git", ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function writeSite(files: Readonly<Record<string, string>>) {
  rmSync(site, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(site, path, ".."), { recursive: true });
    writeFileSync(join(site, path), text);
  }
}

const live = pipe(PublishingBranchImpl.Layer, Layer.provideMerge(OSPlatformImpl.Layer), Layer.provideMerge(BunFileSystem.layer));

function publish(overrides: Partial<PublishInput> = {}) {
  return pipe(
    Effect.result(effunct(function* (): EffectGen<unknown, string, AppGithubPagesModules.PublishingBranch> {
      return yield* (yield* appGithubPagesModules.PublishingBranch).publish({
        siteDir: site,
        remote: { url: remote, token: Option.none() },
        branch: "gh-pages",
        message: "Deploy test",
        ...overrides,
      });
    })()),
    Effect.provide(live),
  );
}

const remoteFiles = () => git(["--git-dir", remote, "ls-tree", "-r", "--name-only", "gh-pages"]).split("\n").filter((line) => line !== "");

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  git(["init", "--quiet", "--bare", remote]);
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe("publish", () => {
  test("creates the branch with exactly the site's files, dotfiles and ignored files included", function* () {
    writeSite({ "index.html": "<h1>one</h1>", ".nojekyll": "", CNAME: "docs.example.com\n", "_astro/app.js": "1", ".gitignore": "*.js\n" });
    const result = yield* publish();
    expect(result._tag).toBe("Success");
    expect(result).toEqual(expect.objectContaining({ success: { commitSha: git(["--git-dir", remote, "rev-parse", "gh-pages"]), changed: true } }));
    expect(remoteFiles().sort()).toEqual([".gitignore", ".nojekyll", "CNAME", "_astro/app.js", "index.html"]);
    expect(git(["--git-dir", remote, "log", "--format=%an <%ae>|%s|%P", "gh-pages"])).toBe("github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>|Deploy test|");
  });

  test("changes nothing when the branch already holds the site", function* () {
    const before = git(["--git-dir", remote, "rev-parse", "gh-pages"]);
    const result = yield* publish();
    expect(result).toEqual(expect.objectContaining({ _tag: "Success", success: { commitSha: before, changed: false } }));
    expect(git(["--git-dir", remote, "rev-parse", "gh-pages"])).toBe(before);
  });

  test("adds a commit on top of the last deploy, removing files the site no longer has", function* () {
    const before = git(["--git-dir", remote, "rev-parse", "gh-pages"]);
    writeSite({ "index.html": "<h1>two</h1>", ".nojekyll": "" });
    const result = yield* publish({ message: "Deploy two" });
    const after = git(["--git-dir", remote, "rev-parse", "gh-pages"]);
    expect(result).toEqual(expect.objectContaining({ _tag: "Success", success: { commitSha: after, changed: true } }));
    expect(git(["--git-dir", remote, "rev-parse", `${after}^`])).toBe(before);
    expect(remoteFiles().sort()).toEqual([".nojekyll", "index.html"]);
  });

  test("never overwrites a commit it did not build on", function* () {
    // Another deploy lands between this one's fetch and push: simulated by moving the branch to an unrelated commit.
    const elsewhere = join(root, "elsewhere");
    git(["init", "--quiet", elsewhere]);
    writeFileSync(join(elsewhere, "index.html"), "<h1>other</h1>");
    git(["-C", elsewhere, "add", "."]);
    git(["-C", elsewhere, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "other"]);
    const other = git(["-C", elsewhere, "rev-parse", "HEAD"]);
    git(["-C", elsewhere, "push", "--quiet", "--force", remote, "HEAD:refs/heads/elsewhere"]);
    class RacedOSPlatform extends OSPlatformImpl {
      override *spawnProcess(input: SpawnProcessInput): EffectGen<ProcessResult, string> {
        // Right before the push, the remote branch moves.
        if (input.args?.includes("push")) git(["--git-dir", remote, "update-ref", "refs/heads/gh-pages", other]);
        return yield* super.spawnProcess(input);
      }
    }
    const failing = new RacedOSPlatform();
    writeSite({ "index.html": "<h1>three</h1>", ".nojekyll": "" });
    const result = yield* pipe(
      Effect.result(effunct(function* () {
        return yield* (yield* appGithubPagesModules.PublishingBranch).publish({ siteDir: site, remote: { url: remote, token: Option.none() }, branch: "gh-pages", message: "Deploy three" });
      })()),
      Effect.provide(pipe(PublishingBranchImpl.Layer, Layer.provideMerge(Layer.succeed(OSPlatform, failing)), Layer.provideMerge(BunFileSystem.layer))),
    );
    expect(result._tag).toBe("Failure");
    expect(result._tag === "Failure" ? result.failure : "").toContain("gh-pages moved while this deploy ran");
    expect(result._tag === "Failure" ? result.failure : "").toContain("(fetch first)");
    expect(git(["--git-dir", remote, "rev-parse", "gh-pages"])).toBe(other);
  });
});

describe("credentials", () => {
  test("sends the token only as an extraheader in the environment, never in arguments, and ignores the machine's git config", function* () {
    const calls: Array<SpawnProcessInput> = [];
    class RecordingOSPlatform extends OSPlatformImpl {
      override *spawnProcess(input: SpawnProcessInput): EffectGen<ProcessResult, string> {
        calls.push(input);
        // ls-remote reports no branch, so the publish goes on to commit and push without fetching.
        return { exitCode: 0, stdout: input.args?.includes("write-tree") || input.args?.includes("commit-tree") ? "abc123\n" : "", stderr: "" };
      }
    }
    const recording = new RecordingOSPlatform();
    writeSite({ "index.html": "<h1>four</h1>" });
    const result = yield* pipe(
      Effect.result(effunct(function* () {
        return yield* (yield* appGithubPagesModules.PublishingBranch).publish({
          siteDir: site,
          remote: { url: "https://github.com/jive-sh/docs.git", token: Option.some(Redacted.make("job-token")) },
          branch: "gh-pages",
          message: "Deploy four",
        });
      })()),
      Effect.provide(pipe(PublishingBranchImpl.Layer, Layer.provideMerge(Layer.succeed(OSPlatform, recording)), Layer.provideMerge(BunFileSystem.layer))),
    );
    expect(result._tag).toBe("Success");
    const push = calls.find((call) => call.args?.includes("push"));
    expect(push?.env).toEqual(expect.objectContaining({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from("x-access-token:job-token").toString("base64")}`,
    }));
    expect(calls.every((call) => !(call.args ?? []).some((arg) => arg.includes("job-token") || arg.includes(Buffer.from("x-access-token:job-token").toString("base64"))))).toBe(true);
  });
});
