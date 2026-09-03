import type {
  ReplacementIntent,
  RunDescriptor,
  WorkspaceManager
} from "../application/contracts.js";
import { loadReplacementIntent, saveReplacementIntent } from "./protected-intent.js";
import { assertTreeUnchanged, computeTreeHash, prepareWorkspace } from "./workspace.js";

export class FileWorkspaceManager implements WorkspaceManager {
  public prepare(sourceFixturePath: string, runRoot: string) {
    return prepareWorkspace(sourceFixturePath, runRoot);
  }

  public computeHash(rootPath: string): Promise<string> {
    return computeTreeHash(rootPath);
  }

  public assertUnchanged(rootPath: string, expectedHash: string): Promise<void> {
    return assertTreeUnchanged(rootPath, expectedHash);
  }

  public saveReplacementIntent(
    runRoot: string,
    workspaceRoot: string,
    runId: string,
    intent: ReplacementIntent
  ): Promise<void> {
    return saveReplacementIntent(runRoot, workspaceRoot, runId, intent);
  }

  public loadReplacementIntent(descriptor: RunDescriptor): Promise<ReplacementIntent> {
    return loadReplacementIntent(descriptor);
  }
}
