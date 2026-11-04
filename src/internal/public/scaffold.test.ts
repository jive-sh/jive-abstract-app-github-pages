import { expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { PackageJsonSchema, crossFieldErrors } from "./manifest";
import { scaffoldFiles } from "./scaffold";

test.each([
  { domain: Option.some("docs.example.com") },
  { domain: Option.none<string>() },
])("a scaffolded package.json passes every manifest rule (domain $domain)", ({ domain }) => {
  const files = scaffoldFiles({ packageName: "@acme/docs", domain, abstractVersion: "0.1.0" });
  const packageJson = Schema.decodeUnknownSync(PackageJsonSchema)(JSON.parse(files["package.json"]!));
  expect(crossFieldErrors(packageJson)).toEqual([]);
  expect(packageJson.jive["app-github-pages"].domain).toEqual(domain);
  expect(packageJson.scripts["jive:cicd:deploy:plan"]).toBe("jive-app-github-pages cicd deploy-plan");
  expect(packageJson.devDependencies).toEqual(Option.some({ "jive-abstract-app-github-pages": "^0.1.0" }));
});

test("the scaffolded pipeline grants the deploy job's token what the deploy uses", () => {
  const pipeline = scaffoldFiles({ packageName: "@acme/docs", domain: Option.none(), abstractVersion: "0.1.0" })[".github/workflows/pipeline.yml"]!;
  expect(pipeline).toContain("permissions:\n  contents: write\n  pages: write\n  id-token: write\n");
  expect(pipeline).toContain("uses: jive-sh/jive/.github/workflows/reusable-pipeline.yml@main");
});
