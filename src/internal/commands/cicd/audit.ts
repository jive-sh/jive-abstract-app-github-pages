import { Effect } from "effect";
import { makeCicdCommand } from "../../common/command";
import { appGithubPagesModules } from "../../modules";
import { ABSTRACT_KEY } from "../../public/manifest";

export const audit = makeCicdCommand(
  "audit",
  "check the build left a site ready to publish: index.html, .nojekyll and the CNAME file the config asks for",
  function* () {
    const config = (yield* (yield* appGithubPagesModules.Package).load()).jive[ABSTRACT_KEY];
    yield* (yield* appGithubPagesModules.Site).check(config);
    yield* Effect.log(`${config.outputDir} is ready to publish`);
  },
);
