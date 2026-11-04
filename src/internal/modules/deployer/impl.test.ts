import { describe, expect, test as buntest } from "bun:test";
import { Duration, Effect, Fiber, Layer, Option, Redacted, Schema, pipe } from "effect";
import { TestClock } from "effect/testing";
import { effunct, type EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";
import { AppGithubPagesModules, appGithubPagesModules } from "../index";
import { PackageImpl } from "../package/impl";
import { PagesApiImpl } from "../pages-api/impl";
import type { PagesBuild, PagesSite } from "../pages-api/interface";
import { PublishingBranchImpl } from "../publishing-branch/impl";
import type { Publication, PublishInput } from "../publishing-branch/interface";
import { SiteImpl } from "../site/impl";
import { PackageJsonSchema, type PackageJson } from "../../public/manifest";
import { BUILD_POLL_INTERVAL, BUILD_TIMEOUT, DeployerImpl } from "./impl";

/**
 * DeployerImpl against fake modules: the order of its calls to the publishing branch and the Pages API, and how each
 * answer GitHub can give ends the deploy. The clock is a test clock, so waiting for a build takes no time.
 */

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const packageJson: PackageJson = Schema.decodeUnknownSync(PackageJsonSchema)({
  $schema: "./package.schema.json",
  name: "@jive-sh/docs",
  version: "0.1.0",
  license: "MIT",
  scripts: {
    ...Object.fromEntries(["get-config", "build", "audit", "deploy:plan", "upload-artifacts", "deploy"].map((hook) => [`jive:cicd:${hook}`, `jive-app-github-pages cicd ${hook}`])),
    build: "astro build",
  },
  jive: {
    cicd: {
      deploy: { verb: "Deploy to", branches: { main: ["Production"] }, previews: false, sequentially: true },
      runsOnPullRequests: true,
      runsOn: "ubuntu-latest",
      requiredSecrets: ["GITHUB_TOKEN"],
    },
    "app-github-pages": { buildScript: "build", outputDir: "dist", domain: "docs.jive.sh" },
  },
});

const context: PipelineContext = {
  provider: "Github",
  repository: { owner: "jive-sh", name: "docs" },
  sourceBranch: "main",
  sourceCommitSha: "1a2b3c4d5e6f708192a3b4c5d6e7f80912345678",
  event: { type: "COMMIT" },
};

const PUBLISHED = "c0ffee0000000000000000000000000000000000";
const PREVIOUS = "deadbeef00000000000000000000000000000000";

const legacySite: PagesSite = {
  buildType: Option.some("legacy"),
  source: Option.some({ branch: "gh-pages", path: "/" }),
  cname: Option.some("docs.jive.sh"),
  htmlUrl: "https://docs.jive.sh/",
};

const built = (commit: string): PagesBuild => ({ status: "built", commit, errorMessage: Option.none() });

interface Scenario {
  readonly environment?: string;
  readonly site?: Option.Option<PagesSite>;
  /** What each call to latestBuild answers, in order; the last answer repeats. */
  readonly latestBuilds: ReadonlyArray<Option.Option<PagesBuild>>;
  readonly requestBuild?: () => EffectGen<void, string>;
}

function deployWith(scenario: Scenario) {
  const calls: Array<{ readonly method: string; readonly input?: unknown }> = [];
  let latestIndex = 0;
  const layers = Layer.mergeAll(
    PackageImpl.mockLayer({ *load(): EffectGen<PackageJson, string> { return packageJson; } }),
    SiteImpl.mockLayer({ *check() { calls.push({ method: "checkSite" }); } }),
    PublishingBranchImpl.mockLayer({
      *publish(input: PublishInput): EffectGen<Publication, string> {
        calls.push({ method: "publish", input: { ...input, remote: { ...input.remote, token: Option.map(input.remote.token, Redacted.value) } } });
        return { commitSha: PUBLISHED, changed: true };
      },
    }),
    PagesApiImpl.mockLayer({
      *getSite() { calls.push({ method: "getSite" }); return scenario.site ?? Option.some(legacySite); },
      *requestBuild() {
        calls.push({ method: "requestBuild" });
        if (scenario.requestBuild !== undefined) yield* scenario.requestBuild();
      },
      *latestBuild() {
        calls.push({ method: "latestBuild" });
        const answer = scenario.latestBuilds[Math.min(latestIndex, scenario.latestBuilds.length - 1)]!;
        latestIndex += 1;
        return answer;
      },
    }),
  );
  const deploy = pipe(
    Effect.result(effunct(function* (): EffectGen<void, string, AppGithubPagesModules.Deployer> {
      yield* (yield* appGithubPagesModules.Deployer).deploy({ environment: scenario.environment ?? "Production", context, token: Redacted.make("job-token") });
    })()),
    Effect.provide(pipe(DeployerImpl.Layer, Layer.provide(layers))),
  );
  return pipe(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(deploy);
      // Past the timeout in poll-sized steps, so a deploy that waits ends however many polls it makes.
      for (let step = 0; step <= Duration.toMillis(BUILD_TIMEOUT) / Duration.toMillis(BUILD_POLL_INTERVAL) + 1; step += 1) {
        yield* TestClock.adjust(BUILD_POLL_INTERVAL);
      }
      return { result: yield* Fiber.join(fiber), calls };
    }),
    Effect.provide(TestClock.layer()),
  );
}

const methods = (calls: ReadonlyArray<{ readonly method: string }>) => calls.map(({ method }) => method);

describe("deploy", () => {
  test("publishes the site, requests its build and waits until GitHub reports the published commit built", function* () {
    const { result, calls } = yield* deployWith({
      latestBuilds: [Option.some(built(PREVIOUS)), Option.some(built(PREVIOUS)), Option.some({ status: "building", commit: PUBLISHED, errorMessage: Option.none() }), Option.some(built(PUBLISHED))],
    });
    expect(result._tag).toBe("Success");
    expect(methods(calls)).toEqual(["checkSite", "publish", "getSite", "latestBuild", "requestBuild", "latestBuild", "latestBuild", "latestBuild"]);
    expect(calls[1]!.input).toEqual({
      siteDir: "dist",
      remote: { url: "https://github.com/jive-sh/docs.git", token: Option.some("job-token") },
      branch: "gh-pages",
      message: "Deploy jive-sh/docs@1a2b3c4d5e6f708192a3b4c5d6e7f80912345678 to Production",
    });
  });

  test("requests no build when GitHub has already built the published commit", function* () {
    const { result, calls } = yield* deployWith({ latestBuilds: [Option.some(built(PUBLISHED))] });
    expect(result._tag).toBe("Success");
    expect(methods(calls)).toEqual(["checkSite", "publish", "getSite", "latestBuild"]);
  });

  test("fails with GitHub's reason when the build errors", function* () {
    const { result } = yield* deployWith({
      latestBuilds: [Option.none(), Option.some({ status: "errored", commit: PUBLISHED, errorMessage: Option.some("Page build failed.") })],
    });
    expect(result).toEqual(expect.objectContaining({ _tag: "Failure", failure: `GitHub Pages could not build ${PUBLISHED}: Page build failed.` }));
  });

  test("waits for a build of the commit already running when GitHub refuses a second", function* () {
    const { result, calls } = yield* deployWith({
      latestBuilds: [Option.some(built(PREVIOUS)), Option.some({ status: "building", commit: PUBLISHED, errorMessage: Option.none() }), Option.some(built(PUBLISHED))],
      *requestBuild() { return yield* Effect.fail("GitHub refused requesting a Pages build with HTTP 409"); },
    });
    expect(result._tag).toBe("Success");
    expect(methods(calls)).toEqual(["checkSite", "publish", "getSite", "latestBuild", "requestBuild", "latestBuild", "latestBuild"]);
  });

  test("fails when GitHub refuses the build and none of the commit is running", function* () {
    const { result, calls } = yield* deployWith({
      latestBuilds: [Option.some(built(PREVIOUS))],
      *requestBuild() { return yield* Effect.fail("GitHub refused requesting a Pages build with HTTP 403: Resource not accessible by integration"); },
    });
    expect(result).toEqual(expect.objectContaining({ _tag: "Failure", failure: "GitHub refused requesting a Pages build with HTTP 403: Resource not accessible by integration" }));
    expect(methods(calls)).toEqual(["checkSite", "publish", "getSite", "latestBuild", "requestBuild", "latestBuild"]);
  });

  test("fails after the timeout when the build never finishes", function* () {
    const { result } = yield* deployWith({ latestBuilds: [Option.some(built(PREVIOUS))] });
    expect(result).toEqual(expect.objectContaining({
      _tag: "Failure",
      failure: `GitHub Pages had not built ${PUBLISHED} after 10m; the latest build is of ${PREVIOUS}, built`,
    }));
  });

  test("fails, after publishing, when the repository has no Pages site", function* () {
    const { result, calls } = yield* deployWith({ site: Option.none(), latestBuilds: [Option.none()] });
    expect(result._tag).toBe("Failure");
    expect(result._tag === "Failure" ? result.failure : "").toContain("jive-sh/docs has no GitHub Pages site");
    expect(result._tag === "Failure" ? result.failure : "").toContain("https://github.com/jive-sh/docs/settings/pages");
    expect(methods(calls)).toEqual(["checkSite", "publish", "getSite"]);
  });

  test("fails when the repository's Pages are published by a workflow instead of the branch", function* () {
    const { result } = yield* deployWith({ site: Option.some({ ...legacySite, buildType: Option.some("workflow") }), latestBuilds: [Option.none()] });
    expect(result._tag === "Failure" ? result.failure : "").toContain("its Pages source is GitHub Actions, not the branch gh-pages at /");
  });

  test("fails when the repository publishes another branch", function* () {
    const { result } = yield* deployWith({ site: Option.some({ ...legacySite, source: Option.some({ branch: "main", path: "/docs" }) }), latestBuilds: [Option.none()] });
    expect(result._tag === "Failure" ? result.failure : "").toContain("its Pages source is the branch main at /docs, not the branch gh-pages at /");
  });

  test("refuses an environment the package does not deploy, before touching anything", function* () {
    const { result, calls } = yield* deployWith({ environment: "Staging", latestBuilds: [Option.none()] });
    expect(result).toEqual(expect.objectContaining({ _tag: "Failure", failure: '"Staging" is not the environment this package deploys its site to ("Production")' }));
    expect(calls).toEqual([]);
  });
});
