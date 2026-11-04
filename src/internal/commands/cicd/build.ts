import { makeCicdCommand } from "../../common/command";
import { appGithubPagesModules } from "../../modules";
import { ABSTRACT_KEY } from "../../public/manifest";

export const build = makeCicdCommand(
  "build",
  "run the package's build script, then add the CNAME and .nojekyll files GitHub Pages reads",
  function* () {
    const config = (yield* (yield* appGithubPagesModules.Package).load()).jive[ABSTRACT_KEY];
    yield* (yield* appGithubPagesModules.Site).build(config);
  },
);
