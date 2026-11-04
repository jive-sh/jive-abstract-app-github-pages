# jive-abstract-app-github-pages

A [Jive](https://github.com/jive-sh/jive) abstract for static sites served by [GitHub Pages](https://pages.github.com).
A site whose `package.json` extends it gets a full CI/CD pipeline with no pipeline code of its own: every push to
its deploy branch builds the site with whatever generator it uses (Astro, Vite, Bun's HTML bundler, plain files),
publishes the result to the repository's `gh-pages` branch, and waits until GitHub Pages reports it built.

Its CLI is `jive-app-github-pages`, so the target command for a new site is `jive create app-github-pages`. Today
the same thing is `jive-app-github-pages create <directory>`.

## Vocabulary

- **Site**: the folder the package's own build script writes, `outputDir`. Its contents are exactly what GitHub
  Pages serves.
- **Publishing branch**: `gh-pages`. Each deploy adds one commit to it whose tree is the site, so its history is
  the history of deploys. GitHub Pages serves it when the repository's Pages source is "Deploy from a branch",
  `gh-pages`, `/`
  ([publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)).
- **Custom domain**: the hostname GitHub Pages serves the site at instead of `https://<owner>.github.io/<repository>/`.
  A branch-published site's custom domain is whatever its `CNAME` file names
  ([custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)),
  so the build writes that file from `domain`.

## Extending it

```jsonc
{
  "$schema": "./package.schema.json",
  "name": "@acme/docs",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "scripts": {
    "jive:cicd:get-config": "jive-app-github-pages cicd get-config",
    "jive:cicd:build": "jive-app-github-pages cicd build",
    "jive:cicd:audit": "jive-app-github-pages cicd audit",
    "jive:cicd:deploy:plan": "jive-app-github-pages cicd deploy-plan",
    "jive:cicd:upload-artifacts": "jive-app-github-pages cicd upload-artifacts",
    "jive:cicd:deploy": "jive-app-github-pages cicd deploy",
    "build": "astro build",
    "dev": "jive-app-github-pages dev"
  },
  "devDependencies": { "jive-abstract-app-github-pages": "^0.1.0" },
  "jive": {
    "cicd": {
      "deploy": { "verb": "Deploy to", "branches": { "main": ["Production"] }, "previews": false, "sequentially": true },
      "runsOnPullRequests": true,
      "runsOn": "ubuntu-latest",
      "requiredSecrets": ["GITHUB_TOKEN"]
    },
    "app-github-pages": {
      "buildScript": "build",
      "outputDir": "dist",
      "domain": "docs.acme.com"
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `buildScript` | The `package.json` script that writes the site into `outputDir`; the build hook runs `bun run <buildScript>`. |
| `outputDir` | The folder, relative to the package, holding the built site. Never the package itself, never outside it. |
| `domain` | A bare lowercase hostname (`docs.acme.com`, never `https://…`), or `null` for `https://<owner>.github.io/<repository>/`. |

Every field is required, so the schema shows everything you can configure. `jive-app-github-pages dev` keeps
`package.schema.json` current, so your editor checks the block as you type it. The hooks also enforce rules that
span fields:

- `cicd.deploy.previews` is false, and `cicd.deploy.branches` deploys at most one environment from one branch: a
  repository has one GitHub Pages site, so there is nowhere else to deploy to.
- `cicd.requiredSecrets` includes `GITHUB_TOKEN`. It is the deploy job's own token, which GitHub puts in every
  workflow's secrets context
  ([contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)); nobody creates or
  stores it, but the pipeline passes the hooks only the secrets listed.
- `buildScript` names a script in `package.json`, and not a `jive:cicd:*` hook, which would loop.

`jive-app-github-pages create <directory> [--name <package>] [--domain <hostname>] [--skip-install]` writes a package
in this shape, with a one-page site in `src/index.html` built by Bun's HTML bundler, its `.gitignore`, a README and
its `.github/workflows/pipeline.yml`.

## What each hook does

| Hook | Behavior |
| --- | --- |
| `get-config` | Prints the validated `jive` block as JSON. |
| `build` | Runs `bun run <buildScript>` and checks it wrote `<outputDir>/index.html`. Then writes `CNAME` naming `domain`, or removes one when `domain` is null (with a warning naming what it replaced or removed), and writes an empty `.nojekyll`, which tells GitHub Pages the branch needs no Jekyll build. Jekyll would otherwise leave out every file and folder starting with `_`, such as Astro's `_astro/` ([Jekyll](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll)). |
| `audit` | Checks the site has `index.html`, `.nojekyll`, and a `CNAME` exactly when `domain` is set, naming it. Replace this script to run the site's own checks as well. |
| `deploy:plan` | Plans a deploy (`{"deploy":true,"url":…}`) to where the site is served: `https://<domain>/` once the domain answers over https with a valid certificate, `http://<domain>/` before (GitHub Pages issues the certificate only after the domain's DNS points at it), or `https://<owner>.github.io/<repository>/` without a domain. |
| `upload-artifacts` | Nothing; the pipeline's artifact already carries `outputDir`. |
| `deploy` | Checks the site again, then publishes it to `gh-pages` as one commit on top of the branch (none when the branch already holds exactly this site), never force-pushed: a deploy that loses a race with another fails and changes nothing. Then it checks the repository's Pages source is `gh-pages` at `/`, requests a GitHub Pages build of the commit, and polls every 5 seconds until GitHub reports that commit `built` (success) or `errored` (failure, with GitHub's reason), for at most 10 minutes. A commit GitHub has already built is not requested again. |

The deploy requests the build itself because a push made with a job's token starts none: "Commits pushed by a
GitHub Actions workflow that uses the GITHUB_TOKEN do not trigger a GitHub Pages build"
([GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)).

## The deploy job's permissions

The deploy uses the job's `GITHUB_TOKEN` for three things, each needing a permission
([permissions for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)):

| Call | Permission |
| --- | --- |
| `git push` to `gh-pages` | `contents: write` |
| `POST /repos/{owner}/{repo}/pages/builds` | `pages: write` |
| `GET /repos/{owner}/{repo}/pages` and `.../pages/builds/latest` | `pages: read` (part of `pages: write`) |

A caller workflow grants the job's token its permissions, and a reusable workflow can only reduce them. The
`pipeline.yml` that `create` writes grants `contents: write`, `pages: write` and `id-token: write`. **Jive's shared
deploy job does not yet pass them on:** [reusable-pipeline.yml](https://github.com/jive-sh/jive/blob/main/.github/workflows/reusable-pipeline.yml)
sets the deploy job's permissions to `contents: read` and `id-token: write` for every package, so until it changes
the push is refused with HTTP 403 and the deploy fails.

## Limitations and open questions

- **Pages must already be set up on the repository.** Creating a Pages site or changing its source needs the
  repository's Administration permission, which no job token can have, so a repository without Pages, or whose
  source is not `gh-pages` at `/`, fails its deploy with the settings page to change. The site is published first,
  so the branch is there to choose. Provisioning it belongs to a GitHub resource connector holding that permission
  on Jive's server, which does not exist yet.
- **https is not enforced.** "Enforce HTTPS" is a Pages setting needing the same Administration permission.
- **The DNS record is not created.** `domain` makes GitHub Pages serve the site there; the record pointing the
  domain at GitHub Pages is yours to create at your DNS provider.
- **No previews.** A repository has one Pages site, so a pull request has nowhere of its own to deploy to.
- **One owner's site.** A repository named `<owner>.github.io` is the owner's own site and is served at its root;
  every other repository is served under `/<repository>/`, so a site without a domain must be built for that base
  path (Astro's `base`, Vite's `base`).

## How it is tested

This repository is a library: its own pipeline publishes it to npm and never deploys a site. `bun run
jive:cicd:audit` runs `tsc` and every test. Nothing in them reaches GitHub:

- Unit tests (`src/**/*.test.ts`) cover the manifest's rules, the site URLs, the scaffold (its `package.json`
  passes every rule), the deploy's sequence against fake modules and a test clock (an already built commit, a
  refused or failing build, a timeout, a repository without Pages or with another source), the Pages API client
  against GitHub responses recorded from jive-sh/docs (`src/internal/modules/pages-api/recorded/`), and the
  publishing branch with real git against a bare repository on disk: the first commit, an unchanged site, removed
  files, a race with another deploy, and that the token travels only in the environment, never in arguments.
- `test/hooks.test.ts` runs `get-config`, `build`, `audit`, `deploy:plan`, `upload-artifacts` and `deploy`'s token
  check through the CLI from source against the fixture site in `test/fixture`, and `create` followed by the new
  package's own build and audit.

What only a consumer's pipeline can test, against its real repository: that GitHub accepts the job's token for the
push and the build request with the permissions above, the request's real `201` body (taken from the docs, not
recorded), and how long a real build takes.
