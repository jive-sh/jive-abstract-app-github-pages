import type { EffectGen } from "effective-modules";

export interface IHttpsProbe {
  /**
   * Whether `https://<hostname>/` answers with a valid certificate, any HTTP status counting as an answer. GitHub
   * Pages serves a custom domain over https only once it has issued the domain a certificate, which nothing in the
   * package can say, so the plan asks the domain.
   */
  servesHttps(hostname: string): EffectGen<boolean>;
}
