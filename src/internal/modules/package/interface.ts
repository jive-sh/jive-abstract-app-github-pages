import type { EffectGen } from "effective-modules";
import type { PackageJson } from "../../public/manifest";

export interface IPackage {
  /**
   * Reads ./package.json and validates it against this abstract's schema, including the rules that span
   * `jive.cicd`, `scripts` and `jive.app-github-pages`, so no hook acts on a manifest another hook would refuse.
   */
  load(): EffectGen<PackageJson, string>;
}
