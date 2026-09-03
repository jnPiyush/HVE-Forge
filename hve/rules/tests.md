# HVE Test Rules

- Write a failing behavioral test before changing implementation behavior.
- Cover acceptance criteria, malformed inputs, boundary values, tampering, retries, and recovery states.
- Use deterministic fixtures, clocks, identifiers, and random seeds.
- Do not call live providers or external services in automated tests.
- Run the full relevant suite and coverage on the final state; cached or stale results are not completion evidence.