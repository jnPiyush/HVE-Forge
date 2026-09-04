/**
 * Narrow, hand-maintained ambient declaration for the subset of the VS Code extension API this
 * extension actually consumes (SPEC-004 section 6.6): extension activation, command
 * registration, the Language Model API, and a minimal output channel. `@types/vscode` was
 * evaluated and rejected for this release because every version available through the
 * configured registry mirror publishes only a legacy SHA-1 integrity hash, which fails this
 * repository's own supply-chain gate (SHA-512 required); this file is the documented fallback
 * the specification anticipates for exactly that situation. It is intentionally incomplete: any
 * additional VS Code surface this extension consumes later must be added here (or the package
 * re-evaluated once it publishes SHA-512 metadata), never widened speculatively.
 */
declare module "vscode" {
  export interface Disposable {
    dispose(): unknown;
  }

  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: (event: unknown) => unknown): Disposable;
  }

  export interface ExtensionContext {
    readonly subscriptions: { push(item: Disposable): unknown };
    readonly extensionPath: string;
    readonly extensionUri: { readonly fsPath: string };
  }

  export interface OutputChannel extends Disposable {
    appendLine(value: string): void;
  }

  export namespace window {
    function createOutputChannel(name: string): OutputChannel;
    function showInformationMessage(
      message: string,
      ...items: string[]
    ): Promise<string | undefined>;
    function showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
  }

  export namespace commands {
    function registerCommand(
      command: string,
      callback: (...args: unknown[]) => unknown
    ): Disposable;
  }

  export interface LanguageModelChatSelector {
    readonly vendor?: string;
    readonly family?: string;
  }

  export interface LanguageModelTextPart {
    readonly value: string;
  }

  export interface LanguageModelToolCallPart {
    readonly callId: string;
    readonly name: string;
    readonly input: unknown;
  }

  export interface LanguageModelChatResponse {
    readonly stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart>;
  }

  export interface LanguageModelChatMessage {
    readonly role: number;
    readonly content: string;
  }

  export namespace LanguageModelChatMessage {
    function User(content: string): LanguageModelChatMessage;
    function Assistant(content: string): LanguageModelChatMessage;
  }

  export interface LanguageModelChatTool {
    readonly name: string;
    readonly description: string;
    readonly inputSchema?: unknown;
  }

  export interface LanguageModelChat {
    readonly id: string;
    readonly vendor: string;
    readonly name: string;
    readonly maxInputTokens: number;
    sendRequest(
      messages: readonly LanguageModelChatMessage[],
      options: { readonly tools?: readonly LanguageModelChatTool[] },
      token: CancellationToken
    ): Promise<LanguageModelChatResponse>;
  }

  export namespace lm {
    function selectChatModels(selector: LanguageModelChatSelector): Promise<LanguageModelChat[]>;
  }

  export class LanguageModelError extends Error {
    readonly code: string;
  }
}
