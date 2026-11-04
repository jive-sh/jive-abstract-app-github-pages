import { Array as Arr, Option, Schema, SchemaTransformation } from "effect";
import { CicdSchema, makeJivePackageJsonSchema, type CicdConfig } from "jive-abstract-library";

/**
 * The shape a package.json must have to be built and deployed by this abstract. The dev server turns
 * `PackageJsonSchema` into the JSON Schema written beside the package's own package.json, and every hook decodes
 * against it, then checks `crossFieldErrors`.
 */

/** The abstract's own block under `jive`, named after its kind as every abstract's block is. */
export const ABSTRACT_KEY = "app-github-pages";

/**
 * The secret the deploy pushes and requests the Pages build with. It is the job's own token, which GitHub puts in
 * every workflow's secrets context (https://docs.github.com/en/actions/reference/workflows-and-actions/contexts),
 * so listing it in `cicd.requiredSecrets` is all a package does; nobody creates or stores it.
 */
export const GITHUB_TOKEN_SECRET = "GITHUB_TOKEN";

/** Hook scripts, which the build script cannot be: the build hook runs it, so naming one would loop. */
const HOOK_SCRIPT_PREFIX = "jive:cicd:";

/**
 * A bare lowercase hostname of two or more DNS labels, such as "docs.example.com": no scheme, port or path. It is
 * written as the site's CNAME file, which holds the hostname alone
 * (https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
 */
const Hostname = Schema.NonEmptyString.check(
  Schema.isMaxLength(253),
  Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
);

/** Why a folder cannot be the site, or nothing when it can. */
function outputDirProblem(path: string): string | undefined {
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return `"${path}" must be relative to the package`;
  const segments = path.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return `"${path}" is the package itself, which would publish its source and node_modules`;
  if (segments.includes("..")) return `"${path}" must stay inside the package`;
  return undefined;
}

/**
 * `Schema.OptionFromNullOr`, spelled out so the description sits on the nullable shape the JSON Schema is generated
 * from; one on the Option it decodes to never reaches the editor.
 */
const Domain = Schema.NullOr(Hostname).annotate({
  description: 'The site\'s custom domain, e.g. "docs.example.com", or null to serve it at https://<owner>.github.io/<repository>/. The build writes it as the site\'s CNAME file, which is what makes GitHub Pages serve the site there; the DNS record pointing it at GitHub Pages is yours to create.',
}).pipe(Schema.decodeTo(Schema.Option(Schema.toType(Hostname)), SchemaTransformation.optionFromNullOr()));

/** The `app-github-pages` block. Every field is required, so the schema lists everything a package can configure. */
export const AppGithubPagesSchema = Schema.Struct({
  buildScript: Schema.NonEmptyString.annotate({
    description: 'The package.json script that writes the site into outputDir, e.g. "build". The build hook runs it as `bun run <buildScript>`.',
  }),
  outputDir: Schema.NonEmptyString
    .annotate({ description: 'The folder, relative to the package, that buildScript writes the site into, e.g. "dist". Its contents are what GitHub Pages serves.' })
    .check(Schema.makeFilter(outputDirProblem)),
  domain: Domain,
});
export type AppGithubPagesConfig = Schema.Schema.Type<typeof AppGithubPagesSchema>;

/** The `jive` block, as `jive:cicd:get-config` prints it. */
export const JivePackageConfig = Schema.Struct({
  cicd: CicdSchema,
  "app-github-pages": AppGithubPagesSchema,
});
export type JivePackageConfig = Schema.Schema.Type<typeof JivePackageConfig>;

export const PackageJsonSchema = makeJivePackageJsonSchema({ "app-github-pages": AppGithubPagesSchema });
export type PackageJson = Schema.Schema.Type<typeof PackageJsonSchema>;

/** The environment a package deploys its site to, and the branch that deploys it. */
export interface DeployTarget {
  readonly branch: string;
  readonly environment: string;
}

function deployTargets(cicd: CicdConfig): ReadonlyArray<DeployTarget> {
  return Object.entries(cicd.deploy.branches).flatMap(([branch, environments]) =>
    environments.map((environment) => ({ branch, environment })));
}

/**
 * Where the site deploys, once `crossFieldErrors` has passed, which leaves at most one: a repository has one GitHub
 * Pages site. None when `cicd.deploy.branches` is `{}`.
 */
export function siteDeployTarget(cicd: CicdConfig): Option.Option<DeployTarget> {
  return Arr.head(deployTargets(cicd));
}

/**
 * Rules that span `cicd`, `scripts` and `app-github-pages`, which no field-level check can see. Returned as one
 * message per broken rule, so a manifest that breaks several is fixed in one pass.
 */
export function crossFieldErrors(packageJson: Pick<PackageJson, "scripts" | "jive">): ReadonlyArray<string> {
  const { cicd } = packageJson.jive;
  const { buildScript } = packageJson.jive[ABSTRACT_KEY];
  const errors: Array<string> = [];

  if (cicd.deploy.previews) {
    errors.push("cicd.deploy.previews must be false: a repository has one GitHub Pages site, so a pull request has no site of its own to deploy to");
  }
  const targets = deployTargets(cicd);
  if (targets.length > 1) {
    errors.push(`cicd.deploy.branches must deploy at most one environment from one branch, since a repository has one GitHub Pages site; it deploys ${targets.map(({ branch, environment }) => `"${environment}" from "${branch}"`).join(", ")}`);
  }
  if (!(cicd.requiredSecrets ?? []).includes(GITHUB_TOKEN_SECRET)) {
    errors.push(`cicd.requiredSecrets must include "${GITHUB_TOKEN_SECRET}": the deploy pushes the site and requests its GitHub Pages build with the job's own token, and the pipeline passes the hooks only the secrets listed there`);
  }
  if (buildScript.startsWith(HOOK_SCRIPT_PREFIX)) {
    errors.push(`jive.${ABSTRACT_KEY}.buildScript is "${buildScript}", a hook script; the build hook runs buildScript, so it must name the script that builds the site`);
  } else if (!Object.hasOwn(packageJson.scripts, buildScript)) {
    errors.push(`jive.${ABSTRACT_KEY}.buildScript is "${buildScript}", which is not a script in package.json`);
  }
  return errors;
}
