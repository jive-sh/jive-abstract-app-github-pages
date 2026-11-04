import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { PackageJsonSchema, crossFieldErrors, siteDeployTarget } from "./manifest";

function manifest(overrides: { readonly cicd?: object; readonly site?: object; readonly scripts?: object } = {}) {
  return {
    $schema: "./package.schema.json",
    name: "@jive-sh/docs",
    version: "0.1.0",
    license: "MIT",
    scripts: {
      ...Object.fromEntries(["get-config", "build", "audit", "deploy:plan", "upload-artifacts", "deploy"].map((hook) => [`jive:cicd:${hook}`, `jive-app-github-pages cicd ${hook}`])),
      build: "astro build",
      ...overrides.scripts,
    },
    jive: {
      cicd: {
        deploy: { verb: "Deploy to", branches: { main: ["Production"] }, previews: false, sequentially: true },
        runsOnPullRequests: true,
        runsOn: "ubuntu-latest",
        requiredSecrets: ["GITHUB_TOKEN"],
        ...overrides.cicd,
      },
      "app-github-pages": { buildScript: "build", outputDir: "dist", domain: "docs.jive.sh", ...overrides.site },
    },
  };
}

const decode = Schema.decodeUnknownSync(PackageJsonSchema);
const deploy = (branches: object, previews = false) => ({ deploy: { verb: "Deploy to", branches, previews, sequentially: true } });

describe("schema", () => {
  test("decodes a valid manifest, the domain as an Option", () => {
    const decoded = decode(manifest());
    expect(decoded.jive["app-github-pages"]).toEqual({ buildScript: "build", outputDir: "dist", domain: Option.some("docs.jive.sh") });
    expect(decode(manifest({ site: { domain: null } })).jive["app-github-pages"].domain).toEqual(Option.none());
  });

  test.each([
    { domain: "https://docs.jive.sh" },
    { domain: "Docs.Jive.sh" },
    { domain: "docs.jive.sh/" },
    { domain: "localhost" },
  ])("rejects the domain $domain, which is not a bare lowercase hostname", ({ domain }) => {
    expect(() => decode(manifest({ site: { domain } }))).toThrow();
  });

  test.each([
    { outputDir: "/var/www", reason: "must be relative to the package" },
    { outputDir: ".", reason: "is the package itself" },
    { outputDir: "./", reason: "is the package itself" },
    { outputDir: "../site", reason: "must stay inside the package" },
  ])("rejects the outputDir $outputDir", ({ outputDir, reason }) => {
    expect(() => decode(manifest({ site: { outputDir } }))).toThrow(reason);
  });

  test("the JSON Schema describes domain as a hostname or null", () => {
    const document = Schema.toJsonSchemaDocument(PackageJsonSchema);
    const text = JSON.stringify(document);
    expect(text).toContain("The site's custom domain");
    expect(text).toContain('"type":"null"');
  });
});

describe("crossFieldErrors", () => {
  test("passes a valid manifest", () => {
    expect(crossFieldErrors(decode(manifest()))).toEqual([]);
  });

  test.each([
    { case: "previews on", cicd: deploy({ main: ["Production"] }, true), error: "cicd.deploy.previews must be false" },
    { case: "two environments", cicd: deploy({ main: ["Staging", "Production"] }), error: 'it deploys "Staging" from "main", "Production" from "main"' },
    { case: "two branches", cicd: deploy({ main: ["Production"], release: ["Production"] }), error: "at most one environment from one branch" },
    { case: "no GITHUB_TOKEN", cicd: { requiredSecrets: ["NPM_TOKEN"] }, error: 'cicd.requiredSecrets must include "GITHUB_TOKEN"' },
  ])("refuses $case", ({ cicd, error }) => {
    expect(crossFieldErrors(decode(manifest({ cicd })))).toEqual([expect.stringContaining(error)]);
  });

  test("refuses a buildScript that is missing or is a hook", () => {
    expect(crossFieldErrors(decode(manifest({ site: { buildScript: "compile" } })))).toEqual([expect.stringContaining('"compile", which is not a script in package.json')]);
    expect(crossFieldErrors(decode(manifest({ site: { buildScript: "jive:cicd:build" } })))).toEqual([expect.stringContaining("a hook script")]);
  });

  test("allows a package that never deploys", () => {
    const decoded = decode(manifest({ cicd: deploy({}) }));
    expect(crossFieldErrors(decoded)).toEqual([]);
    expect(siteDeployTarget(decoded.jive.cicd)).toEqual(Option.none());
  });

  test("names the one deploy target", () => {
    expect(siteDeployTarget(decode(manifest()).jive.cicd)).toEqual(Option.some({ branch: "main", environment: "Production" }));
  });
});
