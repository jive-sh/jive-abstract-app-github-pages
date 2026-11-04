import { expect, test } from "bun:test";
import { customDomainUrl, githubIoUrl } from "./site-url";

test.each([
  { owner: "jive-sh", name: "docs", url: "https://jive-sh.github.io/docs/" },
  { owner: "Jive-SH", name: "Docs", url: "https://jive-sh.github.io/Docs/" },
  { owner: "jive-sh", name: "jive-sh.github.io", url: "https://jive-sh.github.io/" },
  { owner: "Ozyman42", name: "ozyman42.github.io", url: "https://ozyman42.github.io/" },
])("$owner/$name is served at $url", ({ owner, name, url }) => {
  expect(githubIoUrl({ owner, name })).toBe(url);
});

test("a custom domain is served over https once it has a certificate, over http before", () => {
  expect(customDomainUrl({ domain: "docs.jive.sh", servesHttps: true })).toBe("https://docs.jive.sh/");
  expect(customDomainUrl({ domain: "docs.jive.sh", servesHttps: false })).toBe("http://docs.jive.sh/");
});
