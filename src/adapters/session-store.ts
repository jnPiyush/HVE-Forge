import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionEventSink } from "../application/session-contracts.js";
import type { SessionEvent } from "../core/session-events.js";
import { serializeSessionEvent } from "../core/session-events.js";

/**
 * Minimal durable event sink for schema-v2 sessions: appends one hash-chained event per call to
 * a single JSONL file. Unlike `FileRunStore`, it does not yet provide checkpoint/resume/lease
 * recovery; the bounded loop in this release runs a session to a terminal state in one process
 * lifetime, and mid-session crash recovery is a recorded follow-up (see EXEC-PLAN-004).
 */
export class FileSessionEventSink implements SessionEventSink {
  private initialized = false;

  public constructor(private readonly eventsPath: string) {}

  public async append(event: SessionEvent): Promise<void> {
    if (!this.initialized) {
      await mkdir(dirname(this.eventsPath), { recursive: true });
      this.initialized = true;
    }
    const handle = await open(this.eventsPath, "a");
    try {
      await handle.writeFile(`${serializeSessionEvent(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
