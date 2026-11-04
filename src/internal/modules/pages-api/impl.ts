import { Effect, Option, Redacted, Schema, SchemaIssue, pipe } from "effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";
import { implementing, type EffectGen } from "effective-modules";
import { appGithubPagesModules } from "../index";
import type { IPagesApi, PagesApiInput, PagesBuild, PagesSite } from "./interface";

export const GITHUB_API_URL = "https://api.github.com";

/** The REST API version the response shapes below were read from. */
const GITHUB_API_VERSION = "2022-11-28";

const formatSchemaError = SchemaIssue.makeFormatterDefault();

const SiteResponse = Schema.Struct({
  build_type: Schema.NullOr(Schema.Literals(["legacy", "workflow"])),
  source: Schema.OptionFromOptionalNullOr(Schema.Struct({ branch: Schema.String, path: Schema.String })),
  cname: Schema.NullOr(Schema.String),
  html_url: Schema.String,
});

const BuildResponse = Schema.Struct({
  status: Schema.String,
  commit: Schema.String,
  error: Schema.Struct({ message: Schema.NullOr(Schema.String) }),
});

export class PagesApiImpl extends implementing(appGithubPagesModules.PagesApi).uses(HttpClient.HttpClient) implements IPagesApi {
  *getSite(input: PagesApiInput): EffectGen<Option.Option<PagesSite>, string> {
    const response = yield* this.send(input, HttpClientRequest.get(this.url(input, "pages")));
    if (response.status === 404) return Option.none();
    const site = yield* this.decode({ response, schema: SiteResponse, what: "Pages site" });
    return Option.some({
      buildType: Option.fromNullOr(site.build_type),
      source: site.source,
      cname: Option.fromNullOr(site.cname),
      htmlUrl: site.html_url,
    });
  }

  *requestBuild(input: PagesApiInput): EffectGen<void, string> {
    const response = yield* this.send(input, HttpClientRequest.post(this.url(input, "pages/builds")));
    if (response.status !== 201) return yield* Effect.fail(yield* this.refusal({ response, what: "requesting a Pages build" }));
  }

  *latestBuild(input: PagesApiInput): EffectGen<Option.Option<PagesBuild>, string> {
    const response = yield* this.send(input, HttpClientRequest.get(this.url(input, "pages/builds/latest")));
    if (response.status === 404) return Option.none();
    const build = yield* this.decode({ response, schema: BuildResponse, what: "latest Pages build" });
    return Option.some({ status: build.status, commit: build.commit, errorMessage: Option.fromNullOr(build.error.message) });
  }

  private url(input: PagesApiInput, path: string): string {
    return `${GITHUB_API_URL}/repos/${input.repository.owner}/${input.repository.name}/${path}`;
  }

  private *send(input: PagesApiInput, request: HttpClientRequest.HttpClientRequest): EffectGen<HttpClientResponse.HttpClientResponse, string> {
    return yield* pipe(
      request,
      HttpClientRequest.bearerToken(Redacted.value(input.token)),
      HttpClientRequest.setHeaders({ accept: "application/vnd.github+json", "x-github-api-version": GITHUB_API_VERSION }),
      (authorized) => this.getDependency(HttpClient.HttpClient).execute(authorized),
      Effect.mapError((e) => `Cannot reach GitHub's API (${request.method} ${request.url}): ${e.message}`),
    );
  }

  private *decode<S extends Schema.Top & { readonly DecodingServices: never }>(input: {
    readonly response: HttpClientResponse.HttpClientResponse;
    readonly schema: S;
    readonly what: string;
  }): EffectGen<S["Type"], string> {
    const { response, what } = input;
    if (response.status !== 200) return yield* Effect.fail(yield* this.refusal({ response, what: `reading the ${what}` }));
    const body = yield* pipe(response.json, Effect.mapError(() => `GitHub answered the ${what} with HTTP 200 and a body that is not JSON`));
    return yield* pipe(
      Schema.decodeUnknownEffect(input.schema)(body),
      Effect.mapError((e) => `GitHub's ${what} is not in the shape this abstract reads:\n${formatSchemaError(e.issue)}`),
    );
  }

  /** GitHub's own reason for a refusal, which names the missing permission when that is the cause. */
  private *refusal(input: { readonly response: HttpClientResponse.HttpClientResponse; readonly what: string }): EffectGen<string> {
    const text = yield* pipe(input.response.text, Effect.orElseSucceed(() => ""));
    const message = Option.getOrElse(
      Option.flatMap(Option.liftThrowable(JSON.parse)(text), (body) =>
        typeof body === "object" && body !== null && typeof body.message === "string" ? Option.some(body.message as string) : Option.none()),
      () => text.trim(),
    );
    return `GitHub refused ${input.what} with HTTP ${input.response.status}${message === "" ? "" : `: ${message}`}`;
  }
}
