import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RunObserver } from "../application/contracts.js";
import { canonicalizeValue } from "../core/canonical-json.js";
import type { RunEvent } from "../core/events.js";

export const TELEMETRY_VERSION = "1.0.0";

export class FileTelemetryObserver implements RunObserver {
  private pending: Promise<void> = Promise.resolve();

  public constructor(private readonly path: string) {}

  public eventAppended(event: RunEvent): Promise<void> {
    const operation = this.pending.then(() => this.append(event));
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  private async append(event: RunEvent): Promise<void> {
    const path = resolve(this.path);
    await mkdir(dirname(path), { recursive: true });
    const record = canonicalizeValue({
      schemaVersion: event.schemaVersion,
      instrumentationName: "HveForge.Harness",
      instrumentationVersion: TELEMETRY_VERSION,
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      eventHash: event.eventHash
    });
    const handle = await open(path, "a");
    try {
      await handle.writeFile(`${record}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export class NullRunObserver implements RunObserver {
  public async eventAppended(_event: RunEvent): Promise<void> {}
}
