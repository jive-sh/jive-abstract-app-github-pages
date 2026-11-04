import type { Option, Redacted } from "effect";
import type { EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";

export type Repository = PipelineContext["repository"];

/** What every call needs: the repository whose site it acts on, and a token allowed to. */
export interface PagesApiInput {
  readonly repository: Repository;
  readonly token: Redacted.Redacted<string>;
}

/** A repository's GitHub Pages settings, as `GET /repos/{owner}/{repo}/pages` reports them. */
export interface PagesSite {
  /** `legacy` publishes from a branch; `workflow` from an Actions workflow's artifact. */
  readonly buildType: Option.Option<"legacy" | "workflow">;
  readonly source: Option.Option<{ readonly branch: string; readonly path: string }>;
  readonly cname: Option.Option<string>;
  /** Where GitHub says the site is served, e.g. "http://docs.example.com/". */
  readonly htmlUrl: string;
}

/** One GitHub Pages build of a branch-published site. */
export interface PagesBuild {
  /** The build's own API URL, which tells two builds of the same commit apart. */
  readonly url: string;
  /** "built" and "errored" are final; GitHub documents no other values, so anything else is still running. */
  readonly status: string;
  /** The publishing branch's commit it built. */
  readonly commit: string;
  readonly errorMessage: Option.Option<string>;
}

/** GitHub's Pages REST API (https://docs.github.com/en/rest/pages/pages), for the calls the deploy makes. */
export interface IPagesApi {
  /** The repository's Pages settings; none when the repository has no Pages site. Needs `pages: read`. */
  getSite(input: PagesApiInput): EffectGen<Option.Option<PagesSite>, string>;
  /**
   * Asks GitHub to build the site from its publishing branch. Needed after a push made with a job's token, which
   * starts no build by itself ("Commits pushed by a GitHub Actions workflow that uses the GITHUB_TOKEN do not trigger
   * a GitHub Pages build", https://docs.github.com/en/actions/concepts/security/github_token). Needs `pages: write`.
   */
  requestBuild(input: PagesApiInput): EffectGen<void, string>;
  /** The most recent build; none before the site's first. Needs `pages: read`. */
  latestBuild(input: PagesApiInput): EffectGen<Option.Option<PagesBuild>, string>;
}
