export const CLI_CMD_NAME = "jive-app-github-pages";

/** The package this abstract ships as, which a scaffolded package gets as a dev dependency. */
export const ABSTRACT_PACKAGE_NAME = "jive-abstract-app-github-pages";

/**
 * The branch the deploy publishes the site to, at its root. GitHub Pages serves it when the repository's Pages
 * source is this branch and `/`
 * (https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
 */
export const PUBLISHING_BRANCH = "gh-pages";
export const PUBLISHING_PATH = "/";

/**
 * Where the deploy keeps the git repository it publishes the site from, relative to the package. Under
 * `node_modules/.cache`, so no package has to ignore it, and rebuilt by every deploy.
 */
export const PUBLISHING_GIT_DIR = "node_modules/.cache/jive-app-github-pages/publishing.git";

/** Files the build adds to the site, which GitHub Pages reads rather than serves as pages. */
export const SITE_FILES = {
  /** Holds the custom domain; a branch-published site's domain is whatever this file names. */
  customDomain: "CNAME",
  /**
   * Tells GitHub Pages the branch needs no Jekyll build
   * (https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
   * Jekyll would otherwise leave out every file and folder starting with `_`, such as Astro's `_astro/`
   * (https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll).
   */
  disableJekyll: ".nojekyll",
} as const;

/** The page every built site must have, since GitHub Pages serves it at the site's root. */
export const SITE_INDEX_FILE = "index.html";
