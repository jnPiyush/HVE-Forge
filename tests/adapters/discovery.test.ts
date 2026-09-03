import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectInstructions } from "../../src/adapters/instructions.js";
import { activateSkill, inspectSkills } from "../../src/adapters/skills.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("instruction and skill discovery", () => {
  it("selects the nearest AGENTS.md and reports parent conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "hve-instructions-"));
    roots.push(root);
    await mkdir(join(root, "src/nested"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root", "utf8");
    await writeFile(join(root, "src/AGENTS.md"), "nested", "utf8");
    await writeFile(join(root, "src/nested/file.ts"), "content", "utf8");
    const selection = await selectInstructions(root, "src/nested/file.ts");
    expect(selection.relativePath).toBe("src/AGENTS.md");
    expect(selection.content).toBe("nested");
    expect(selection.conflicts).toEqual([
      "src/AGENTS.md overrides AGENTS.md for the target scope."
    ]);
  });

  it("inspects and activates portable skills with stable hashes", async () => {
    const skillsRoot = resolve("hve/skills");
    const skills = await inspectSkills(skillsRoot);
    expect(skills.map((skill) => skill.name)).toContain("hve-review");
    const activated = await activateSkill(skillsRoot, "exact-text-replacement");
    expect(activated.descriptor.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(activated.instructions).toContain("# Exact Text Replacement");
  });

  it("accepts nested Agent Skills metadata and folded scalar descriptions", async () => {
    const root = await mkdtemp(join(tmpdir(), "hve-skills-"));
    roots.push(root);
    const skillRoot = join(root, "nested-metadata");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      [
        "---",
        "name: nested-metadata",
        "description: >",
        "  A standards-compatible skill with nested metadata that must not shadow",
        "  or duplicate top-level frontmatter keys during bounded inspection.",
        "metadata:",
        "  name: display-name-only",
        "  vendor:",
        "    version: '1.0'",
        "compatibility: |",
        "  Node 24",
        "  Windows, macOS, and Linux",
        "---",
        "",
        "# Nested Metadata",
        ""
      ].join("\n"),
      "utf8"
    );

    const skills = await inspectSkills(root);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("nested-metadata");
    expect(skills[0]?.description).toContain("nested metadata");
    expect(skills[0]?.compatibility).toContain("Node 24\nWindows");
  });

  it("parses quoted scalars, comments, and allowed-tool lists", async () => {
    const root = await mkdtemp(join(tmpdir(), "hve-skills-"));
    roots.push(root);
    const skillRoot = join(root, "quoted-skill");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      [
        "---",
        'name: "quoted-skill"',
        "description: 'A quoted standards-compatible skill description with enough detail for discovery.'",
        "license: MIT # SPDX identifier",
        "allowed-tools:",
        "  - Read",
        "  - 'Grep'",
        "---",
        "",
        "# Quoted Skill",
        ""
      ].join("\n"),
      "utf8"
    );

    const skill = (await inspectSkills(root))[0];

    expect(skill?.license).toBe("MIT");
    expect(skill?.allowedTools).toBe("Read, Grep");
  });

  it.each([
    [
      "missing start",
      "name: invalid\ndescription: This description is deliberately long enough for validation.\n"
    ],
    [
      "missing end",
      "---\nname: invalid\ndescription: This description is deliberately long enough for validation.\n"
    ],
    [
      "tab",
      "---\nname: invalid\n\tdescription: This description is deliberately long enough for validation.\n---\n"
    ],
    [
      "invalid line",
      "---\nname invalid\ndescription: This description is deliberately long enough for validation.\n---\n"
    ],
    [
      "duplicate",
      "---\nname: invalid\nname: invalid\ndescription: This description is deliberately long enough for validation.\n---\n"
    ],
    ["short description", "---\nname: invalid\ndescription: short\n---\n"],
    [
      "bad reference",
      "---\nname: invalid\ndescription: This description is deliberately long enough for validation.\n---\n[escape](../../outside.md)\n"
    ]
  ])("rejects %s skill metadata", async (_name, content) => {
    const root = await mkdtemp(join(tmpdir(), "hve-skills-invalid-"));
    roots.push(root);
    const skillRoot = join(root, "invalid");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), content, "utf8");
    await expect(inspectSkills(root)).rejects.toThrow();
  });

  it("rejects invalid UTF-8, oversized skills, and mismatched names", async () => {
    const invalidUtf8Root = await mkdtemp(join(tmpdir(), "hve-skills-utf8-"));
    const oversizedRoot = await mkdtemp(join(tmpdir(), "hve-skills-large-"));
    const mismatchRoot = await mkdtemp(join(tmpdir(), "hve-skills-name-"));
    roots.push(invalidUtf8Root, oversizedRoot, mismatchRoot);
    await mkdir(join(invalidUtf8Root, "invalid"));
    await writeFile(join(invalidUtf8Root, "invalid/SKILL.md"), Uint8Array.from([0xff]));
    await mkdir(join(oversizedRoot, "large"));
    await writeFile(join(oversizedRoot, "large/SKILL.md"), "x".repeat(102_401), "utf8");
    await mkdir(join(mismatchRoot, "actual-name"));
    await writeFile(
      join(mismatchRoot, "actual-name/SKILL.md"),
      "---\nname: other-name\ndescription: This description is deliberately long enough for validation.\n---\n",
      "utf8"
    );

    await expect(inspectSkills(invalidUtf8Root)).rejects.toThrow("UTF-8");
    await expect(inspectSkills(oversizedRoot)).rejects.toThrow("exceeds");
    await expect(inspectSkills(mismatchRoot)).rejects.toThrow("match");
  });

  it("handles missing roots and rejects invalid activation names", async () => {
    const root = await mkdtemp(join(tmpdir(), "hve-skills-empty-"));
    roots.push(root);
    const file = join(root, "not-a-directory");
    await writeFile(file, "content", "utf8");
    expect(await inspectSkills(join(root, "missing"))).toEqual([]);
    expect(await inspectSkills(file)).toEqual([]);
    await expect(activateSkill(root, "Bad Name")).rejects.toThrow("kebab-case");
    await expect(activateSkill(root, "missing-skill")).rejects.toThrow("not found");
  });

  it("rejects linked skill directories when supported", async () => {
    const root = await mkdtemp(join(tmpdir(), "hve-skills-link-"));
    const outside = await mkdtemp(join(tmpdir(), "hve-skills-outside-"));
    roots.push(root, outside);
    try {
      await symlink(outside, join(root, "linked"), "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }
    await expect(inspectSkills(root)).rejects.toThrow("link");
  });
});
