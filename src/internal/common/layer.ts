import { Layer, pipe } from "effect";
import { FetchHttpClient } from "effect/http";
import { BunFileSystem } from "@effect/platform-bun";
import { OSPlatformImpl } from "jive-abstract-library";
import { DeployerImpl } from "../modules/deployer/impl";
import { HttpsProbeImpl } from "../modules/https-probe/impl";
import { PackageImpl } from "../modules/package/impl";
import { PagesApiImpl } from "../modules/pages-api/impl";
import { PublishingBranchImpl } from "../modules/publishing-branch/impl";
import { ScaffoldImpl } from "../modules/scaffold/impl";
import { SiteImpl } from "../modules/site/impl";

/** Every module this abstract owns, composed most-dependent first. */
export const layerLive = pipe(
  DeployerImpl.Layer,
  Layer.provideMerge(ScaffoldImpl.Layer),
  Layer.provideMerge(PublishingBranchImpl.Layer),
  Layer.provideMerge(PagesApiImpl.Layer),
  Layer.provideMerge(HttpsProbeImpl.Layer),
  Layer.provideMerge(SiteImpl.Layer),
  Layer.provideMerge(PackageImpl.Layer),
  Layer.provideMerge(OSPlatformImpl.Layer),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(BunFileSystem.layer),
) satisfies Layer.Layer<any, any, never>;
