import type { PipelineContext } from "jive-abstract-library";

/**
 * Where GitHub Pages serves a repository's site without a custom domain: a project site at
 * `https://<owner>.github.io/<repository>/`, or the owner's own site at `https://<owner>.github.io/` when the
 * repository is named `<owner>.github.io`
 * (https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#types-of-github-pages-sites).
 * GitHub's hostnames are lowercase, so the owner is lowercased; the path keeps the repository's own case.
 */
export function githubIoUrl(repository: PipelineContext["repository"]): string {
  const host = `${repository.owner.toLowerCase()}.github.io`;
  return repository.name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repository.name}/`;
}

/** Where GitHub Pages serves a site at its custom domain, over https once the domain's certificate is issued. */
export function customDomainUrl(input: { readonly domain: string; readonly servesHttps: boolean }): string {
  return `${input.servesHttps ? "https" : "http"}://${input.domain}/`;
}
