import { Effect } from "effect";
import { makePipelineCommand } from "../../common/command";

export const uploadArtifacts = makePipelineCommand(
  "upload-artifacts",
  "no-op: the pipeline's own artifact carries the built site to the deploy job",
  function* (context) {
    yield* Effect.log(`Nothing to upload for ${context.repository.owner}/${context.repository.name}`);
  },
);
