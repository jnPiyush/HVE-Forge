import type {
  EvaluatorRubric,
  HandoffPacket,
  RuntimeContractValidator,
  WorkContract
} from "../application/contracts.js";
import { canonicalizeJson } from "../core/canonical-json.js";
import { readConfinedRegularFile } from "./path-safety.js";
import { assertJsonSchema } from "./schema-validator.js";

export class SchemaContractValidator implements RuntimeContractValidator {
  public constructor(private readonly repositoryRoot: string) {}

  public async parseWorkContract(content: string): Promise<WorkContract> {
    return (await this.parse(content, "work-contract")) as WorkContract;
  }

  public async parseEvaluatorRubric(content: string): Promise<EvaluatorRubric> {
    const value = JSON.parse(canonicalizeJson(content)) as unknown;
    if (!isObject(value)) throw new Error("Evaluator rubric must be an object.");
    exactKeys(value, [
      "schemaVersion",
      "rubricVersion",
      "dimensions",
      "blockingSeverities",
      "generatorRationaleIsEvidence",
      "requiresReadOnlyEvaluator",
      "requiresExactFinalHashes"
    ]);
    return value as unknown as EvaluatorRubric;
  }

  public async parseHandoff(content: string): Promise<HandoffPacket> {
    return (await this.parse(content, "handoff")) as HandoffPacket;
  }

  private async parse(content: string, schemaName: string): Promise<unknown> {
    const value = JSON.parse(canonicalizeJson(content)) as unknown;
    const schema = JSON.parse(
      canonicalizeJson(
        await readConfinedRegularFile(this.repositoryRoot, `schemas/v1/${schemaName}.schema.json`)
      )
    ) as unknown;
    assertJsonSchema(value, schema);
    return value;
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    throw new Error("Evaluator rubric fields are invalid.");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
