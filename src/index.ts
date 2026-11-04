/**
 * The public surface of this abstract: the package.json shape a site extending it must have, and its scaffold. The
 * hooks themselves ship as the `jive-app-github-pages` command.
 */
export {
  ABSTRACT_KEY,
  AppGithubPagesSchema,
  GITHUB_TOKEN_SECRET,
  JivePackageConfig,
  PackageJsonSchema,
  crossFieldErrors,
  siteDeployTarget,
  type AppGithubPagesConfig,
  type DeployTarget,
  type PackageJson,
} from "./internal/public/manifest";
export { scaffoldFiles, type ScaffoldFiles, type ScaffoldInput } from "./internal/public/scaffold";
export { customDomainUrl, githubIoUrl } from "./internal/public/site-url";
