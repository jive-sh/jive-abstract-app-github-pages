import { Duration, Effect, Option } from "effect";
import { effunct, implementing, type EffectGen } from "effective-modules";
import { PUBLISHING_BRANCH, PUBLISHING_PATH } from "../../common/constants";
import { ABSTRACT_KEY, siteDeployTarget } from "../../public/manifest";
import { appGithubPagesModules } from "../index";
import type { PagesApiInput, PagesBuild, PagesSite } from "../pages-api/interface";
import type { DeployInput, IDeployer } from "./interface";

/** How often the deploy reads the latest build while waiting, and how long it waits in all. */
export const BUILD_POLL_INTERVAL = Duration.seconds(5);
export const BUILD_TIMEOUT = Duration.minutes(10);

const FINAL_BUILD_STATUSES = ["built", "errored"];

/** Why a repository's Pages settings would not serve the publishing branch, or nothing when they would. */
function sourceProblem(site: PagesSite): Option.Option<string> {
  const source = Option.getOrUndefined(site.source);
  const buildType = Option.getOrUndefined(site.buildType);
  if (buildType === "legacy" && source?.branch === PUBLISHING_BRANCH && source.path === PUBLISHING_PATH) return Option.none();
  return Option.some(`its Pages source is ${buildType === "workflow"
    ? "GitHub Actions"
    : source === undefined ? "not set" : `the branch ${source.branch} at ${source.path}`}, not the branch ${PUBLISHING_BRANCH} at ${PUBLISHING_PATH}`);
}

export class DeployerImpl extends implementing(appGithubPagesModules.Deployer)
  .uses(appGithubPagesModules.Package, appGithubPagesModules.Site, appGithubPagesModules.PublishingBranch, appGithubPagesModules.PagesApi)
  implements IDeployer {
  *deploy(input: DeployInput): EffectGen<void, string> {
    const { Package, Site, PublishingBranch, PagesApi } = this.dependencies;
    const { context, environment, token } = input;
    const packageJson = yield* Package.load();
    const config = packageJson.jive[ABSTRACT_KEY];
    const target = siteDeployTarget(packageJson.jive.cicd);
    if (Option.isNone(target) || target.value.environment !== environment) {
      return yield* Effect.fail(`"${environment}" is not the environment this package deploys its site to${Option.isSome(target) ? ` ("${target.value.environment}")` : "; cicd.deploy.branches deploys nothing"}`);
    }
    yield* Site.check(config);

    const { owner, name } = context.repository;
    const repositoryName = `${owner}/${name}`;
    const api: PagesApiInput = { repository: context.repository, token };
    yield* Effect.log(`Publishing ${config.outputDir} to ${repositoryName}'s ${PUBLISHING_BRANCH} branch for ${environment}`);
    const { commitSha } = yield* PublishingBranch.publish({
      siteDir: config.outputDir,
      remote: { url: `https://github.com/${repositoryName}.git`, token: Option.some(token) },
      branch: PUBLISHING_BRANCH,
      message: `Deploy ${repositoryName}@${context.sourceCommitSha} to ${environment}`,
    });

    const site = yield* PagesApi.getSite(api);
    const settings = `https://github.com/${repositoryName}/settings/pages`;
    if (Option.isNone(site)) {
      return yield* Effect.fail(`${repositoryName} has no GitHub Pages site, so GitHub serves nothing from ${PUBLISHING_BRANCH}. Enabling one needs a repository administrator, which a job's token is not: at ${settings}, set the source to "Deploy from a branch", ${PUBLISHING_BRANCH}, ${PUBLISHING_PATH}`);
    }
    const problem = sourceProblem(site.value);
    if (Option.isSome(problem)) {
      return yield* Effect.fail(`${repositoryName}'s GitHub Pages would not serve what this deploy published: ${problem.value}. Changing it needs a repository administrator, which a job's token is not: at ${settings}, set the source to "Deploy from a branch", ${PUBLISHING_BRANCH}, ${PUBLISHING_PATH}`);
    }

    const latest = yield* PagesApi.latestBuild(api);
    if (Option.isSome(latest) && latest.value.commit === commitSha && latest.value.status === "built") {
      yield* Effect.log(`GitHub Pages has already built ${commitSha}; ${site.value.htmlUrl} serves it`);
      return;
    }
    // The build that was latest before the request is never the one requested, even when it is of the same commit:
    // a rerun after a failed build publishes the same commit, and must not stop at its old failure.
    const earlier = Option.map(latest, ({ url }) => url);
    yield* this.requestBuild({ api, commitSha, earlier });
    const build = yield* this.awaitBuild({ api, commitSha, earlier });
    if (build.status !== "built") {
      return yield* Effect.fail(`GitHub Pages could not build ${commitSha}: ${Option.getOrElse(build.errorMessage, () => `its build ended "${build.status}"`)}`);
    }
    yield* Effect.log(`GitHub Pages built ${commitSha}; ${site.value.htmlUrl} serves it`);
  }

  /**
   * Requests the build. GitHub runs one build per repository at a time, so a refusal while a build of this commit
   * already exists is that build, and the deploy waits for it instead of failing.
   */
  private *requestBuild(input: { readonly api: PagesApiInput; readonly commitSha: string; readonly earlier: Option.Option<string> }): EffectGen<void, string> {
    const { PagesApi } = this.dependencies;
    const requested = yield* Effect.result(effunct(PagesApi.requestBuild.bind(PagesApi))(input.api));
    if (requested._tag === "Success") {
      yield* Effect.log(`Requested a GitHub Pages build of ${input.commitSha}`);
      return;
    }
    const latest = yield* PagesApi.latestBuild(input.api);
    if (Option.isSome(latest) && this.isNewBuildOf({ build: latest.value, commitSha: input.commitSha, earlier: input.earlier })) {
      yield* Effect.log(`A GitHub Pages build of ${input.commitSha} is already ${latest.value.status}, so the request was refused: ${requested.failure}`);
      return;
    }
    return yield* Effect.fail(requested.failure);
  }

  private isNewBuildOf(input: { readonly build: PagesBuild; readonly commitSha: string; readonly earlier: Option.Option<string> }): boolean {
    return input.build.commit === input.commitSha && !Option.contains(input.earlier, input.build.url);
  }

  private *awaitBuild(input: { readonly api: PagesApiInput; readonly commitSha: string; readonly earlier: Option.Option<string> }): EffectGen<PagesBuild, string> {
    const { PagesApi } = this.dependencies;
    const deadline = Duration.toMillis(BUILD_TIMEOUT);
    let waited = 0;
    for (;;) {
      const latest = yield* PagesApi.latestBuild(input.api);
      if (Option.isSome(latest) && this.isNewBuildOf({ build: latest.value, commitSha: input.commitSha, earlier: input.earlier }) && FINAL_BUILD_STATUSES.includes(latest.value.status)) {
        return latest.value;
      }
      if (waited >= deadline) {
        return yield* Effect.fail(`GitHub Pages had not built ${input.commitSha} after ${Duration.format(BUILD_TIMEOUT)}; the latest build is ${Option.match(latest, {
          onNone: () => "none",
          onSome: (build) => `of ${build.commit}, ${build.status}`,
        })}`);
      }
      yield* Effect.sleep(BUILD_POLL_INTERVAL);
      waited += Duration.toMillis(BUILD_POLL_INTERVAL);
    }
  }
}
