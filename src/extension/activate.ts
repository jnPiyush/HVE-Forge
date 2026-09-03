import { join } from "node:path";
import * as vscode from "vscode";
import { defaultDistributionRoot, loadDistributionIdentity } from "../cli/distribution-root.js";
import { createDefaultAgentSession } from "../cli/session-composition.js";
import { VsCodeAtomicModelProvider } from "./language-model-port.js";
import { VsCodeChatModelSelector } from "./vscode-lm-adapter.js";

const COMMAND_ID = "hve-forge.runAgentSession";

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Extension composition root (SPEC-004 section 6.2). Contains no policy, path-safety, or loop
 * logic of its own -- every decision is delegated to the same compiled kernel and application
 * ports the CLI uses, resolved from this extension's own compiled location rather than an
 * installed package (section 6.7/6.8), so the two surfaces cannot diverge on a policy question.
 * `vscode` is a host-injected module, never a bundled dependency (section 6.6): the extension
 * host resolves this bare specifier at load time, so this file's only difference from a plain
 * Node module is that it can never run outside a real VS Code extension host.
 */
export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("HVE-Forge");
  context.subscriptions.push(outputChannel);
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, () => {
      void runAgentSessionCommand(context);
    })
  );
}

export function deactivate(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}

async function runAgentSessionCommand(context: vscode.ExtensionContext): Promise<void> {
  const log = (line: string): void => outputChannel?.appendLine(line);
  try {
    const selector = new VsCodeChatModelSelector(vscode.lm);
    const provider = new VsCodeAtomicModelProvider(selector);
    const selection = await provider.resolveModel();
    if (selection.kind === "empty") {
      // Empty model selection is a first-class, actionable state (SPEC-004 section 6.1), never
      // an error: the loop is never started, and the operator gets a concrete next step.
      await vscode.window.showInformationMessage(
        "HVE-Forge: no Copilot language model is available. Sign in to GitHub Copilot, or select a model, then run this command again."
      );
      return;
    }
    log(`Resolved language model: ${selection.model.id}`);

    const distributionRoot = defaultDistributionRoot();
    const distribution = await loadDistributionIdentity(distributionRoot);
    log(`Distribution root: ${distribution.root} (package ${distribution.packageVersion})`);

    // This command runs the same bounded demo task the CLI's `agent-run` command runs, but with
    // a live Copilot model choosing each turn instead of a scripted fixture. Running the loop
    // against an arbitrary open workspace folder (rather than the packaged sample fixture),
    // native mutation confirmation, and a chat-participant surface are recorded follow-ups
    // (EXEC-PLAN-004 slice 8); this vertical slice proves model selection, distribution-identity
    // resolution, and the bounded loop are wired correctly from inside a real extension host,
    // which no kernel or application test can exercise.
    const composition = await createDefaultAgentSession({
      repositoryRoot: distribution.root,
      sourceFixturePath: join(distribution.root, "samples/fixture-repo"),
      runsRoot: join(context.extensionPath, ".hve-sessions"),
      provider
    });
    const result = await composition.run({ isCancellationRequested: false });
    log(
      `Session ${composition.descriptor.sessionId} finished with status ${result.projection.status}.`
    );
    if (result.projection.status === "completed") {
      await vscode.window.showInformationMessage(
        `HVE-Forge: bounded session completed in ${result.projection.turnsUsed} turn(s) using ${selection.model.id}.`
      );
    } else {
      await vscode.window.showErrorMessage(
        `HVE-Forge: session ended as ${result.projection.status} (${result.projection.terminalReason ?? result.projection.stopReason ?? "unknown"}).`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    await vscode.window.showErrorMessage(`HVE-Forge: ${message}`);
  }
}
