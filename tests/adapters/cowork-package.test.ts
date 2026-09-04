import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCoworkPackage,
  CoworkPackageError,
  validateCoworkManifest
} from "../../src/adapters/cowork-package.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Builds the minimal bytes a PNG-dimension reader needs: signature + an IHDR chunk. */
function minimalPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  const length = Buffer.alloc(4);
  length.writeUInt32BE(ihdrData.length, 0);
  const type = Buffer.from("IHDR", "ascii");
  const crc = Buffer.alloc(4); // not validated by the reader under test
  return Buffer.concat([signature, length, type, ihdrData, crc]);
}

async function skillsFixture(options: { includeIneligible?: boolean } = {}): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hve-cowork-")));
  roots.push(root);
  await mkdir(join(root, "eligible-skill"), { recursive: true });
  await writeFile(
    join(root, "eligible-skill/SKILL.md"),
    [
      "---",
      "name: eligible-skill",
      "description: A skill with a long enough description to satisfy the fifty character minimum length rule.",
      "cowork-eligible: true",
      "---",
      "",
      "# Eligible Skill",
      ""
    ].join("\n"),
    "utf8"
  );
  if (options.includeIneligible !== false) {
    await mkdir(join(root, "shell-skill"), { recursive: true });
    await writeFile(
      join(root, "shell-skill/SKILL.md"),
      [
        "---",
        "name: shell-skill",
        "description: A skill that assumes terminal access and is not eligible for Cowork packaging at all.",
        "---",
        "",
        "# Shell Skill",
        ""
      ].join("\n"),
      "utf8"
    );
  }
  return root;
}

async function iconsFixture(): Promise<{ colorIconPath: string; outlineIconPath: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hve-cowork-icons-")));
  roots.push(root);
  const colorIconPath = join(root, "color.png");
  const outlineIconPath = join(root, "outline.png");
  await writeFile(colorIconPath, minimalPng(192, 192));
  await writeFile(outlineIconPath, minimalPng(32, 32));
  return { colorIconPath, outlineIconPath };
}

describe("buildCoworkPackage", () => {
  it("packages only cowork-eligible skills with a manifest and both icons at the archive root", async () => {
    const skillsRoot = await skillsFixture();
    const { colorIconPath, outlineIconPath } = await iconsFixture();

    const result = await buildCoworkPackage({ skillsRoot, colorIconPath, outlineIconPath });

    expect(result.includedSkills).toEqual(["eligible-skill"]);
    expect(result.excludedSkills).toEqual([
      {
        name: "shell-skill",
        reason: "Skill is not marked cowork-eligible: true; it assumes host execution."
      }
    ]);
    expect(result.manifest.agentSkills).toEqual([{ file: "skills/eligible-skill/SKILL.md" }]);
    expect(validateCoworkManifest(result.manifest)).toEqual(result.manifest);

    const entries = readZipEntryNames(result.archive);
    expect(entries).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "color.png",
        "outline.png",
        "skills/eligible-skill/SKILL.md"
      ])
    );
    expect(entries).not.toContain("skills/shell-skill/SKILL.md");
  });

  it("produces a byte-identical archive across repeated renders", async () => {
    const skillsRoot = await skillsFixture();
    const { colorIconPath, outlineIconPath } = await iconsFixture();
    const first = await buildCoworkPackage({ skillsRoot, colorIconPath, outlineIconPath });
    const second = await buildCoworkPackage({ skillsRoot, colorIconPath, outlineIconPath });
    expect(Buffer.from(second.archive).equals(Buffer.from(first.archive))).toBe(true);
    expect(first.manifest.id).toBe(second.manifest.id);
  });

  it("fails closed when no skill is cowork-eligible", async () => {
    const skillsRoot = await skillsFixture({ includeIneligible: true });
    // Remove the only eligible skill, leaving nothing packageable.
    await rm(join(skillsRoot, "eligible-skill"), { recursive: true, force: true });
    const { colorIconPath, outlineIconPath } = await iconsFixture();
    await expect(
      buildCoworkPackage({ skillsRoot, colorIconPath, outlineIconPath })
    ).rejects.toThrow(CoworkPackageError);
  });

  it("rejects icons with the wrong pixel dimensions", async () => {
    const skillsRoot = await skillsFixture();
    const iconRoot = await realpath(await mkdtemp(join(tmpdir(), "hve-cowork-badicon-")));
    roots.push(iconRoot);
    const colorIconPath = join(iconRoot, "color.png");
    const outlineIconPath = join(iconRoot, "outline.png");
    await writeFile(colorIconPath, minimalPng(64, 64));
    await writeFile(outlineIconPath, minimalPng(32, 32));
    await expect(
      buildCoworkPackage({ skillsRoot, colorIconPath, outlineIconPath })
    ).rejects.toThrow("192x192");
  });

  it("rejects a non-PNG icon file", async () => {
    const skillsRoot = await skillsFixture();
    const iconRoot = await realpath(await mkdtemp(join(tmpdir(), "hve-cowork-notpng-")));
    roots.push(iconRoot);
    const colorIconPath = join(iconRoot, "color.png");
    const outlineIconPath = join(iconRoot, "outline.png");
    await writeFile(colorIconPath, Buffer.from("not a png"));
    await writeFile(outlineIconPath, minimalPng(32, 32));
    await expect(
      buildCoworkPackage({ skillsRoot, colorIconPath, outlineIconPath })
    ).rejects.toThrow("not a valid PNG");
  });
});

describe("validateCoworkManifest", () => {
  const valid = {
    manifestVersion: "v2.2",
    id: "12345678-1234-1234-1234-123456789012",
    version: "1.0.0",
    developer: { name: "HVE-Forge" },
    name: "HVE-Forge",
    description: "A description.",
    icons: { color: "color.png", outline: "outline.png" },
    agentSkills: [{ file: "skills/example-skill/SKILL.md" }]
  };

  it("accepts a well-formed manifest", () => {
    expect(validateCoworkManifest(valid)).toEqual(valid);
  });

  it("rejects unexpected fields, wrong version, and empty skill lists", () => {
    expect(() => validateCoworkManifest({ ...valid, extra: true })).toThrow(
      "Unexpected manifest field"
    );
    expect(() => validateCoworkManifest({ ...valid, manifestVersion: "v1" })).toThrow("v2.2");
    expect(() => validateCoworkManifest({ ...valid, agentSkills: [] })).toThrow("non-empty array");
    expect(() =>
      validateCoworkManifest({ ...valid, agentSkills: [{ file: "not-under-skills.md" }] })
    ).toThrow("invalid path");
    expect(() =>
      validateCoworkManifest({
        ...valid,
        agentSkills: [{ file: "skills/a/SKILL.md" }, { file: "skills/a/SKILL.md" }]
      })
    ).toThrow("unique");
  });
});

function readZipEntryNames(archive: Uint8Array): readonly string[] {
  const buffer = Buffer.from(archive);
  const names: string[] = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    names.push(buffer.toString("utf8", offset + 30, offset + 30 + nameLength));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}
