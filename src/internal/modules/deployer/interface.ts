import type { Redacted } from "effect";
import type { EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";

export interface DeployInput {
  readonly environment: string;
  readonly context: PipelineContext;
  /** The job's token, allowed to push the publishing branch and to request and read its Pages builds. */
  readonly token: Redacted.Redacted<string>;
}

export interface IDeployer {
  /**
   * Publishes the built site to the repository's publishing branch, requests its GitHub Pages build and waits for
   * it, failing unless GitHub reports the published commit built. Checks first that the site is built and that
   * `environment` is the one the package deploys, and after publishing that the repository's Pages source is that
   * branch, so a site GitHub would never serve fails the deploy instead of passing it.
   */
  deploy(input: DeployInput): EffectGen<void, string>;
}
