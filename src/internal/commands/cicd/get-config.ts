import { Schema } from "effect";
import { makeCicdCommand } from "../../common/command";
import { appGithubPagesModules } from "../../modules";
import { JivePackageConfig } from "../../public/manifest";

export const getConfig = makeCicdCommand(
  "get-config",
  "print this package's validated jive config as JSON for the pipeline's context job",
  function* () {
    const { jive } = yield* (yield* appGithubPagesModules.Package).load();
    process.stdout.write(`${JSON.stringify(Schema.encodeUnknownSync(JivePackageConfig)(jive))}\n`);
  },
);
