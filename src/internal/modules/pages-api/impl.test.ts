import { describe, expect, test as buntest } from "bun:test";
import { Effect, Layer, Option, Redacted, pipe } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { effunct, type EffectGen } from "effective-modules";
import { join } from "node:path";
import { AppGithubPagesModules, appGithubPagesModules } from "../index";
import { GITHUB_API_URL, PagesApiImpl } from "./impl";
import type { PagesApiInput } from "./interface";

/**
 * PagesApiImpl against a fake HTTP client answering with responses recorded from GitHub (`recorded/`): it checks
 * the request each call sends and how each answer is read. No request leaves the process.
 */

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const recorded = (file: string) => Bun.file(join(import.meta.dir, "recorded", file)).text();

interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const api: PagesApiInput = { repository: { owner: "jive-sh", name: "docs" }, token: Redacted.make("job-token") };

function withAnswer<A>(answer: { readonly status: number; readonly body: string }, program: () => EffectGen<A, any, AppGithubPagesModules.PagesApi>) {
  const sent: Array<SentRequest> = [];
  const client = HttpClient.make((request, url) => Effect.sync(() => {
    sent.push({ method: request.method, url: url.href, headers: request.headers });
    return HttpClientResponse.fromWeb(request, new Response(answer.body, { status: answer.status }));
  }));
  return pipe(
    Effect.result(effunct(program)()),
    Effect.map((result) => ({ result, sent })),
    Effect.provide(pipe(PagesApiImpl.Layer, Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))),
  );
}

describe("getSite", () => {
  test("reads a branch-published site's source, domain and URL", function* () {
    const body = yield* Effect.promise(() => recorded("site-legacy-gh-pages.json"));
    const { result, sent } = yield* withAnswer({ status: 200, body }, function* () {
      return yield* (yield* appGithubPagesModules.PagesApi).getSite(api);
    });
    expect(sent).toEqual([{
      method: "GET",
      url: `${GITHUB_API_URL}/repos/jive-sh/docs/pages`,
      headers: expect.objectContaining({
        authorization: "Bearer job-token",
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      }),
    }]);
    expect(result._tag).toBe("Success");
    const site = Option.getOrThrow(result._tag === "Success" ? result.success : Option.none());
    expect(site.buildType).toEqual(Option.some("legacy"));
    expect(site.source).toEqual(Option.some({ branch: "gh-pages", path: "/" }));
    expect(site.cname).toEqual(Option.some("docs.jive.sh"));
    expect(site.htmlUrl).toBe(JSON.parse(body).html_url);
  });

  test("reports no site on a 404", function* () {
    const body = yield* Effect.promise(() => recorded("site-none.json"));
    const { result } = yield* withAnswer({ status: 404, body }, function* () {
      return yield* (yield* appGithubPagesModules.PagesApi).getSite(api);
    });
    expect(result).toEqual(expect.objectContaining({ _tag: "Success", success: Option.none() }));
  });

  test("passes on GitHub's reason for a refusal", function* () {
    const { result } = yield* withAnswer({ status: 403, body: JSON.stringify({ message: "Resource not accessible by integration" }) }, function* () {
      return yield* (yield* appGithubPagesModules.PagesApi).getSite(api);
    });
    expect(result).toEqual(expect.objectContaining({
      _tag: "Failure",
      failure: "GitHub refused reading the Pages site with HTTP 403: Resource not accessible by integration",
    }));
  });
});

describe("latestBuild", () => {
  test("reads a finished build's commit", function* () {
    const body = yield* Effect.promise(() => recorded("build-built.json"));
    const { result, sent } = yield* withAnswer({ status: 200, body }, function* () {
      return yield* (yield* appGithubPagesModules.PagesApi).latestBuild(api);
    });
    expect(sent.map(({ method, url }) => ({ method, url }))).toEqual([{ method: "GET", url: `${GITHUB_API_URL}/repos/jive-sh/docs/pages/builds/latest` }]);
    expect(result).toEqual(expect.objectContaining({
      _tag: "Success",
      success: Option.some({ status: "built", commit: JSON.parse(body).commit, errorMessage: Option.none() }),
    }));
  });

  test("reads a failed build's error", function* () {
    const body = yield* Effect.promise(() => recorded("build-errored.json"));
    const { result } = yield* withAnswer({ status: 200, body }, function* () {
      return yield* (yield* appGithubPagesModules.PagesApi).latestBuild(api);
    });
    expect(result).toEqual(expect.objectContaining({
      _tag: "Success",
      success: Option.some({ status: "errored", commit: JSON.parse(body).commit, errorMessage: Option.some("Page build failed.") }),
    }));
  });

  test("reports no build on a 404", function* () {
    const { result } = yield* withAnswer({ status: 404, body: JSON.stringify({ message: "Not Found" }) }, function* () {
      return yield* (yield* appGithubPagesModules.PagesApi).latestBuild(api);
    });
    expect(result).toEqual(expect.objectContaining({ _tag: "Success", success: Option.none() }));
  });
});

describe("requestBuild", () => {
  test("posts to the builds endpoint and accepts the documented 201", function* () {
    const { result, sent } = yield* withAnswer({ status: 201, body: JSON.stringify({ url: `${GITHUB_API_URL}/repos/jive-sh/docs/pages/builds/latest`, status: "queued" }) }, function* () {
      yield* (yield* appGithubPagesModules.PagesApi).requestBuild(api);
    });
    expect(result._tag).toBe("Success");
    expect(sent.map(({ method, url }) => ({ method, url }))).toEqual([{ method: "POST", url: `${GITHUB_API_URL}/repos/jive-sh/docs/pages/builds` }]);
  });

  test("fails with the missing permission GitHub names", function* () {
    const { result } = yield* withAnswer({ status: 403, body: JSON.stringify({ message: "Resource not accessible by integration" }) }, function* () {
      yield* (yield* appGithubPagesModules.PagesApi).requestBuild(api);
    });
    expect(result).toEqual(expect.objectContaining({
      _tag: "Failure",
      failure: "GitHub refused requesting a Pages build with HTTP 403: Resource not accessible by integration",
    }));
  });
});
