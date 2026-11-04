import type { EffectGen } from "effective-modules";
import type { ScaffoldInput } from "../../public/scaffold";

export interface CreateInput {
  /** Where the package goes; it must not exist yet, or be empty. */
  readonly directory: string;
  readonly scaffold: ScaffoldInput;
  /** Whether to run `bun install` in it afterwards, so its hooks can run at once. */
  readonly install: boolean;
}

export interface IScaffold {
  /** Writes a new package extending this abstract and returns the paths written, relative to `directory`. */
  create(input: CreateInput): EffectGen<ReadonlyArray<string>, string>;
}
