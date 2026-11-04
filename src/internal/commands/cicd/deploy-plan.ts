import { Effect, Option } from "effect";
import { makeDeployPlanCommand } from "../../common/command";
import { appGithubPagesModules } from "../../modules";
import { ABSTRACT_KEY, siteDeployTarget } from "../../public/manifest";
import { customDomainUrl, githubIoUrl } from "../../public/site-url";

export const deployPlan = makeDeployPlanCommand(
  "deploy-plan",
  "plan a deploy to the URL GitHub Pages serves this site at",
  function* ({ environment, context }) {
    const { jive } = yield* (yield* appGithubPagesModules.Package).load();
    const target = siteDeployTarget(jive.cicd);
    if (Option.isNone(target) || target.value.environment !== environment) {
      return yield* Effect.fail(`"${environment}" is not the environment this package deploys its site to`);
    }
    const { domain } = jive[ABSTRACT_KEY];
    const url = Option.isSome(domain)
      ? customDomainUrl({ domain: domain.value, servesHttps: yield* (yield* appGithubPagesModules.HttpsProbe).servesHttps(domain.value) })
      : githubIoUrl(context.repository);
    yield* Effect.log(`${environment} is served at ${url}`);
    return { deploy: true, url } as const;
  },
);
