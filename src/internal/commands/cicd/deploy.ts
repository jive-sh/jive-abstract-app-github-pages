import { makeDeployCommand } from "../../common/command";
import { readGithubToken } from "../../common/github-token";
import { appGithubPagesModules } from "../../modules";

export const deploy = makeDeployCommand(
  "deploy",
  "publish the built site to the gh-pages branch and wait for GitHub Pages to build it",
  function* ({ environment, context }) {
    const token = yield* readGithubToken();
    yield* (yield* appGithubPagesModules.Deployer).deploy({ environment, context, token });
  },
);
