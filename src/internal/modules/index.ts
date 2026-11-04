import { interfaces } from "effective-modules";
import type { IDeployer } from "./deployer/interface";
import type { IHttpsProbe } from "./https-probe/interface";
import type { IPackage } from "./package/interface";
import type { IPagesApi } from "./pages-api/interface";
import type { IPublishingBranch } from "./publishing-branch/interface";
import type { IScaffold } from "./scaffold/interface";
import type { ISite } from "./site/interface";

export enum AppGithubPagesModules {
  Package = "Package",
  Site = "Site",
  HttpsProbe = "HttpsProbe",
  PublishingBranch = "PublishingBranch",
  PagesApi = "PagesApi",
  Deployer = "Deployer",
  Scaffold = "Scaffold",
}

export const appGithubPagesModules = interfaces<AppGithubPagesModules, {
  Package: IPackage;
  Site: ISite;
  HttpsProbe: IHttpsProbe;
  PublishingBranch: IPublishingBranch;
  PagesApi: IPagesApi;
  Deployer: IDeployer;
  Scaffold: IScaffold;
}>(AppGithubPagesModules);
