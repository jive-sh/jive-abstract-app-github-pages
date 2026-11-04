import type { EffectGen } from "effective-modules";
import type { AppGithubPagesConfig } from "../../public/manifest";

/** The built site in `outputDir`: what GitHub Pages serves once the deploy has published it. */
export interface ISite {
  /**
   * Runs the package's `buildScript`, checks it wrote `index.html` into `outputDir`, then makes the site's CNAME
   * file name `domain` (removing one when `domain` is null, since `domain` is the only place the domain is set) and
   * adds `.nojekyll`.
   */
  build(config: AppGithubPagesConfig): EffectGen<void, string>;
  /** Checks `outputDir` holds a site the build finished: `index.html`, `.nojekyll`, and a CNAME file exactly when `domain` is set, naming it. */
  check(config: AppGithubPagesConfig): EffectGen<void, string>;
}
