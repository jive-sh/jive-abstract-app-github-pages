import type { Option, Redacted } from "effect";
import type { EffectGen } from "effective-modules";

/** A git remote, and the GitHub token that may push to it; none for a remote that needs no credential. */
export interface GitRemote {
  readonly url: string;
  readonly token: Option.Option<Redacted.Redacted<string>>;
}

export interface PublishInput {
  /** The folder whose contents become the branch's whole tree. */
  readonly siteDir: string;
  readonly remote: GitRemote;
  readonly branch: string;
  readonly message: string;
}

export interface Publication {
  /** The commit the branch points at once the publish is done. */
  readonly commitSha: string;
  /** Whether this publish pushed a new commit; false when the branch already held exactly this site. */
  readonly changed: boolean;
}

/**
 * Makes a remote branch hold exactly one folder's contents, as one new commit on top of what the branch held, so
 * its history is the history of deploys. The push is never forced: a deploy that lost a race to another fails
 * instead of discarding the other's commit.
 */
export interface IPublishingBranch {
  publish(input: PublishInput): EffectGen<Publication, string>;
}
