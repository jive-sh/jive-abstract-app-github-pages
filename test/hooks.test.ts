import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The hooks as the pipeline runs them: `bun run <hook>` in the fixture site (test/fixture), whose scripts run this
 * abstract's CLI from source. `deploy` is left out: it pushes to GitHub, which only a consumer's pipeline does
 * (its logic is tested against fakes and real git in src/internal/modules).
 */

const fixture = resolve(import.meta.dir, "fixture");
const dist = join(fixture, "dist");
const created = resolve(import.meta.dir, "..", "node_modules/.cache/create-test");

const context = {
  provider: "Github",
  repository: { owner: "jive-sh", name: "github-pages-fixture" },
  sourceBranch: "main",
  sourceCommitSha: "1a2b3c4d5e6f708192a3b4c5d6e7f80912345678",
  event: { type: "COMMIT" },
};

async function run(command: ReadonlyArray<string>, input: { readonly cwd: string; readonly env?: Record<string, string> } = { cwd: fixture }) {
  // Async spawn, never spawnSync, as the effect skill's testing rules ask.
  const proc = Bun.spawn([...command], { cwd: input.cwd, env: { ...process.env, ...input.env }, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr };
}

const hook = (name: string, env?: Record<string, string>) => run(["bun", "run", name], { cwd: fixture, env });

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
  rmSync(created, { recursive: true, force: true });
});

describe("hooks", () => {
  test("get-config prints the validated jive block, and only that, on stdout", async () => {
    const { exitCode, stdout } = await hook("jive:cicd:get-config");
    expect(exitCode).toBe(0);
    const config = JSON.parse(stdout);
    expect(config["app-github-pages"]).toEqual({ buildScript: "build", outputDir: "dist", domain: null });
    expect(config.cicd.requiredSecrets).toEqual(["GITHUB_TOKEN"]);
  });

  test("build runs the build script and adds .nojekyll, without a CNAME when domain is null", async () => {
    rmSync(dist, { recursive: true, force: true });
    const { exitCode, stderr } = await hook("jive:cicd:build");
    expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(existsSync(join(dist, "index.html"))).toBe(true);
    expect(readFileSync(join(dist, ".nojekyll"), "utf8")).toBe("");
    expect(existsSync(join(dist, "CNAME"))).toBe(false);
  });

  test("audit passes the built site, and fails one that lost .nojekyll", async () => {
    expect((await hook("jive:cicd:audit")).exitCode).toBe(0);
    rmSync(join(dist, ".nojekyll"));
    const { exitCode, stderr } = await hook("jive:cicd:audit");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("dist/.nojekyll is missing");
    writeFileSync(join(dist, ".nojekyll"), "");
  });

  test("audit fails a CNAME the config does not ask for", async () => {
    writeFileSync(join(dist, "CNAME"), "stale.example.com\n");
    const { exitCode, stderr } = await hook("jive:cicd:audit");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('names "stale.example.com", but jive.app-github-pages.domain is null');
    rmSync(join(dist, "CNAME"));
  });

  test("deploy-plan plans a deploy to the github.io URL, and only that JSON on stdout", async () => {
    const { exitCode, stdout } = await hook("jive:cicd:deploy:plan", { JIVE_DEPLOY_ENVIRONMENT: "Production", JIVE_PIPELINE_CONTEXT: JSON.stringify(context) });
    expect(exitCode).toBe(0);
    expect(stdout).toBe('{"deploy":true,"url":"https://jive-sh.github.io/github-pages-fixture/"}\n');
  });

  test("deploy-plan refuses an environment the package does not deploy", async () => {
    const { exitCode, stdout, stderr } = await hook("jive:cicd:deploy:plan", { JIVE_DEPLOY_ENVIRONMENT: "Staging", JIVE_PIPELINE_CONTEXT: JSON.stringify(context) });
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain('"Staging" is not the environment this package deploys its site to');
  });

  test("upload-artifacts does nothing and succeeds", async () => {
    expect((await hook("jive:cicd:upload-artifacts", { JIVE_PIPELINE_CONTEXT: JSON.stringify(context) })).exitCode).toBe(0);
  });

  test("deploy refuses to run without the job's token", async () => {
    const { exitCode, stderr } = await hook("jive:cicd:deploy", { GITHUB_TOKEN: "", JIVE_DEPLOY_ENVIRONMENT: "Production", JIVE_PIPELINE_CONTEXT: JSON.stringify(context) });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("GITHUB_TOKEN is not set");
  });
});

describe("create", () => {
  test("writes a package whose own build hook builds its site", async () => {
    rmSync(created, { recursive: true, force: true });
    const cli = resolve(import.meta.dir, "../src/entrypoints/jive-app-github-pages.ts");
    const { exitCode, stderr } = await run(["bun", cli, "create", created, "--name", "@acme/docs", "--domain", "docs.example.com", "--skip-install"], { cwd: fixture });
    expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(readdirSync(created).sort()).toEqual([".github", ".gitignore", "README.md", "package.json", "src"]);

    // Its hooks name the installed CLI; run this checkout's instead, as an install of this version would.
    const packageJson = JSON.parse(readFileSync(join(created, "package.json"), "utf8"));
    expect(packageJson.name).toBe("@acme/docs");
    expect(packageJson.jive["app-github-pages"].domain).toBe("docs.example.com");
    const build = await run(["bun", cli, "cicd", "build"], { cwd: created });
    expect({ exitCode: build.exitCode, stderr: build.exitCode === 0 ? "" : build.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(readFileSync(join(created, "dist", "CNAME"), "utf8")).toBe("docs.example.com\n");
    expect((await run(["bun", cli, "cicd", "audit"], { cwd: created })).exitCode).toBe(0);
  });

  test("refuses a directory that is not empty", async () => {
    const cli = resolve(import.meta.dir, "../src/entrypoints/jive-app-github-pages.ts");
    const { exitCode, stderr } = await run(["bun", cli, "create", created, "--skip-install"], { cwd: fixture });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not empty");
  });
});
