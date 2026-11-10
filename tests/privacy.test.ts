import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TENANTS } from "../prisma/seed/data";

// Privacy and secrets regression checks (STAR-43). Static only: reads tracked files, never a database.

const root = new URL("..", import.meta.url).pathname;

function tracked(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

const read = (f: string) => readFileSync(root + f, "utf8");

// Reserved or example domains only (RFC 2606 / 6761), including per-tenant subdomains like demo-gym.example.test.
const SAFE_DOMAIN = /(^|\.)(example\.(test|com|invalid)|example)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

function badEmails(text: string): string[] {
  return [...text.matchAll(EMAIL)].map((m) => m[0]).filter((e) => !SAFE_DOMAIN.test(e.split("@")[1]));
}

const seedFiles = () =>
  tracked().filter(
    (f) => /^prisma\/seed\//.test(f) || /^public\/.*\.csv$/.test(f) || /^data\/exercises\//.test(f),
  );

describe("privacy: seed data", () => {
  it("uses only example.test / example.com style email domains in seeds and sample CSV", () => {
    const offenders = seedFiles().flatMap((f) => badEmails(read(f)).map((e) => `${f}: ${e}`));
    expect(offenders).toEqual([]);
  });

  it("detects a real-looking email (self check)", () => {
    expect(badEmails("someone@gmail.com a@example.test b@demo-gym.example.test")).toEqual(["someone@gmail.com"]);
  });

  it("seed tenants, people and guardians have synthetic 'Sample ' names", () => {
    for (const t of TENANTS) {
      expect(t.name).toMatch(/^Sample /);
      for (const p of [t.owner, ...t.coaches, ...t.guardians, ...t.members]) expect(p.name).toMatch(/^Sample /);
    }
  });

  it("has no photos or other binary media of people in public/ or seeds", () => {
    const media = tracked().filter(
      (f) => /^(public|prisma|data\/exercises)\//.test(f) && /\.(png|jpe?g|gif|webp|heic|avif|bmp|tiff?|mp4|mov)$/i.test(f),
    );
    expect(media).toEqual([]);
    for (const f of tracked().filter((p) => /^public\/.*\.svg$/.test(p))) {
      expect(read(f), f).not.toMatch(/<image\b|data:image\//i);
    }
  });

  it("uses only obviously fake phone numbers in seed and sample CSV", () => {
    const text = ["prisma/seed/demo.ts", "prisma/seed/data.ts", "public/sample-members.csv"].map(read).join("\n");
    const phones = [...text.matchAll(/\+91[ -]?(\d{10})/g)].map((m) => m[1]);
    for (const p of phones) expect(p, p).toMatch(/^9?0{3,}/);
  });
});

describe("privacy: secrets and env files", () => {
  it("tracks no .env or .neon files except .env.example", () => {
    const bad = tracked().filter((f) => /(^|\/)\.env(\..+)?$/.test(f) && !/(^|\/)\.env\.example$/.test(f));
    expect(bad).toEqual([]);
    expect(tracked().filter((f) => /(^|\/)\.neon(\/|$)/.test(f))).toEqual([]);
  });

  it("git-ignores .env, .env.local and .neon", () => {
    const gitignore = read(".gitignore").split(/\r?\n/).map((l) => l.trim());
    for (const entry of [".env", ".env.local", ".neon"]) expect(gitignore).toContain(entry);
  });

  it("only has connection strings that point at localhost", () => {
    const URL_RE = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"'`<>)]+/gi;
    const offenders: string[] = [];
    for (const f of tracked()) {
      if (/package-lock\.json$|^data\/free-exercise-db\/|^\.claude\/skills\//.test(f)) continue;
      if (/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(f)) continue;
      for (const m of read(f).matchAll(URL_RE)) {
        const rest = m[0].replace(/^[a-z+]+:\/\//i, "");
        const hostPart = rest.slice(rest.lastIndexOf("@") + 1);
        const host = hostPart.split(/[/:?]/)[0].replace(/^\$\{?/, "");
        if (!["localhost", "127.0.0.1", "db"].includes(host)) offenders.push(`${f}: host ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no neon.tech database host or well-known secret token shapes in tracked code", () => {
    const SECRETS = [
      /ep-[a-z]+-[a-z]+-\d+[^\s]*\.neon\.tech/i,
      /AKIA[0-9A-Z]{16}/,
      /\bsk-[A-Za-z0-9_-]{20,}/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}/,
      /\bnapi_[a-z0-9]{20,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    const offenders: string[] = [];
    for (const f of tracked()) {
      if (/package-lock\.json$|^data\/free-exercise-db\/|\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(f)) continue;
      const text = read(f);
      for (const re of SECRETS) if (re.test(text)) offenders.push(`${f}: ${re.source}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the only password in .env.example the local docker placeholder", () => {
    const text = read(".env.example");
    for (const m of text.matchAll(/PASSWORD=(\S+)/g)) expect(m[1]).toBe("allstar_local_dev");
    expect(text).not.toMatch(/neon\.tech/i);
  });
});
