import { Effect, pipe } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { implementing, type EffectGen } from "effective-modules";
import { appGithubPagesModules } from "../index";
import type { IHttpsProbe } from "./interface";

const PROBE_TIMEOUT = "10 seconds";

export class HttpsProbeImpl extends implementing(appGithubPagesModules.HttpsProbe).uses(HttpClient.HttpClient) implements IHttpsProbe {
  *servesHttps(hostname: string): EffectGen<boolean> {
    const answered = yield* pipe(
      this.getDependency(HttpClient.HttpClient).execute(HttpClientRequest.head(`https://${hostname}/`)),
      Effect.timeout(PROBE_TIMEOUT),
      Effect.as(true),
      Effect.catchTags({ HttpClientError: () => Effect.succeed(false), TimeoutError: () => Effect.succeed(false) }),
    );
    yield* Effect.log(answered
      ? `https://${hostname}/ answers with a valid certificate`
      : `https://${hostname}/ does not answer over https (no certificate yet, or no DNS record), so the site's URL is http://${hostname}/`);
    return answered;
  }
}
