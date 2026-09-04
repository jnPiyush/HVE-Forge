export class SecretRedactor {
  private readonly secrets: readonly string[];

  public constructor(secretValues: readonly string[]) {
    this.secrets = [...new Set(secretValues.filter((value) => value.length > 0))].sort(
      (left, right) => right.length - left.length
    );
  }

  public redact(value: string): string {
    let result = value;
    for (const secret of this.secrets) result = result.replaceAll(secret, "[REDACTED]");
    return result;
  }
}
