import type * as vscode from "vscode";
import type {
  LanguageModelChatLike,
  LanguageModelRequestMessage,
  LanguageModelResponsePart,
  LanguageModelSelectorPort,
  LanguageModelToolSpec
} from "./language-model-port.js";

/**
 * The only file that imports `vscode` for model selection. It is a thin translation layer: all
 * decision logic (empty-model handling, error translation, turn assembly) lives in
 * `language-model-port.ts` and is tested without an extension host.
 */
export interface VsCodeLanguageModelNamespace {
  selectChatModels(selector: { readonly vendor?: string }): Promise<vscode.LanguageModelChat[]>;
}

export class VsCodeChatModelSelector implements LanguageModelSelectorPort {
  public constructor(private readonly api: VsCodeLanguageModelNamespace) {}

  public async selectChatModels(vendor: string): Promise<readonly LanguageModelChatLike[]> {
    const models = await this.api.selectChatModels({ vendor });
    return models.map((model) => wrapChatModel(model));
  }
}

function wrapChatModel(model: vscode.LanguageModelChat): LanguageModelChatLike {
  return {
    id: model.id,
    vendor: model.vendor,
    maxInputTokens: model.maxInputTokens,
    sendRequest: async (messages, tools, cancellation) => {
      const response = await model.sendRequest(
        messages.map(toVsCodeMessage),
        { tools: tools.map(toVsCodeTool) },
        toVsCodeCancellationToken(cancellation)
      );
      return translateResponseStream(response.stream);
    }
  };
}

function toVsCodeMessage(message: LanguageModelRequestMessage): {
  readonly role: number;
  readonly content: string;
} {
  // Role 1 is User, role 2 is Assistant in the VS Code Language Model API's numeric enum.
  return { role: message.role === "user" ? 1 : 2, content: message.content };
}

function toVsCodeTool(tool: LanguageModelToolSpec): vscode.LanguageModelChatTool {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

function toVsCodeCancellationToken(cancellation: {
  readonly isCancellationRequested: boolean;
}): vscode.CancellationToken {
  return {
    get isCancellationRequested() {
      return cancellation.isCancellationRequested;
    },
    onCancellationRequested: () => ({ dispose: () => undefined })
  };
}

async function* translateResponseStream(
  stream: AsyncIterable<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>
): AsyncGenerator<LanguageModelResponsePart> {
  for await (const part of stream) {
    if ("value" in part) {
      yield { kind: "text", text: part.value };
    } else {
      yield { kind: "tool_call", callId: part.callId, toolId: part.name, arguments: part.input };
    }
  }
}
