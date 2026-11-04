# Recorded GitHub Pages API responses

Bodies GitHub's REST API returned on 2026-11-04, read with an authenticated `gh api`, which the
[impl tests](../impl.test.ts) serve through a fake HTTP client:

| File | Request | Repository |
| --- | --- | --- |
| `site-legacy-gh-pages.json` | `GET /repos/{owner}/{repo}/pages` | jive-sh/docs, published from `gh-pages` at `/` |
| `site-none.json` | `GET /repos/{owner}/{repo}/pages`, HTTP 404 | jive-sh/jive-abstract-library, which has no Pages site |
| `build-built.json` | `GET /repos/{owner}/{repo}/pages/builds/latest` | jive-sh/docs |
| `build-errored.json` | one `errored` entry of `GET /repos/{owner}/{repo}/pages/builds` | jive-sh/docs |

`POST /repos/{owner}/{repo}/pages/builds` is not recorded: requesting a build of a live site is an action, not a
read. Its tests use the documented 201 body, `url` and `status`
([Request a GitHub Pages build](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)).
