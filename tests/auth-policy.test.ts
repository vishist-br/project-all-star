import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { ApiError } from "../lib/auth/errors";
import { authorizeWith, checkRole } from "../lib/auth/guard";
import { OPERATION_ROLES, type OperationId } from "../lib/auth/policy";
import type { Principal } from "../lib/auth/principal";
import { ROLES, toApiRole, toDbRole, type ApiRole } from "../lib/auth/roles";

const p = (role: ApiRole): Principal => ({ userId: `u-${role}`, tenantId: "t1", role });

function contractRoles(): Record<string, string[] | "public"> {
  const src = readFileSync("docs/api/openapi.yaml", "utf8");
  const out: Record<string, string[] | "public"> = {};
  for (const m of src.matchAll(/operationId: (\w+)[\s\S]*?x-roles: \[([^\]]*)\]/g)) {
    const roles = m[2].split(",").map((s) => s.trim());
    out[m[1]] = roles.length === 1 && roles[0] === "public" ? "public" : roles;
  }
  return out;
}

describe("roles", () => {
  it("are exactly owner, coach, customer and match the DB enum", () => {
    expect([...ROLES]).toEqual(["owner", "coach", "customer"]);
    expect(Object.values(Role).sort()).toEqual(["COACH", "CUSTOMER", "OWNER"]);
    for (const r of ROLES) expect(toApiRole(toDbRole(r))).toBe(r);
  });
});

describe("policy matches docs/api/openapi.yaml", () => {
  const contract = contractRoles();
  it("covers every contract operation and nothing else", () => {
    expect(Object.keys(OPERATION_ROLES).sort()).toEqual(Object.keys(contract).sort());
  });
  for (const [op, roles] of Object.entries(contract)) {
    it(`${op}`, () => {
      const mine = OPERATION_ROLES[op as OperationId] as readonly string[] | "public";
      expect(mine === "public" ? "public" : [...mine].sort()).toEqual(
        roles === "public" ? "public" : [...roles].sort(),
      );
    });
  }
});

describe("checkRole: allowed and denied for each role", () => {
  const ops = Object.keys(OPERATION_ROLES) as OperationId[];
  for (const op of ops) {
    for (const role of ROLES) {
      const rule = OPERATION_ROLES[op] as readonly string[] | "public";
      const allowed = rule === "public" || rule.includes(role);
      it(`${op} as ${role} -> ${allowed ? "allowed" : "403"}`, () => {
        if (allowed) expect(checkRole(p(role), op)).toEqual(p(role));
        else
          expect(() => checkRole(p(role), op)).toThrowError(
            expect.objectContaining({ code: "forbidden", status: 403 }),
          );
      });
    }
    if (OPERATION_ROLES[op] !== "public") {
      it(`${op} without credentials -> 401`, () => {
        expect(() => checkRole(null, op)).toThrowError(expect.objectContaining({ code: "unauthorized", status: 401 }));
      });
    }
  }

  it("owner-only operations deny coach and customer", () => {
    for (const op of ["updateTenantTheme", "importMembersCsv"] as const) {
      expect(() => checkRole(p("coach"), op)).toThrow(ApiError);
      expect(() => checkRole(p("customer"), op)).toThrow(ApiError);
      expect(checkRole(p("owner"), op)).toBeTruthy();
    }
  });

  it("customer cannot list members", () => {
    expect(() => checkRole(p("customer"), "listMembers")).toThrow(ApiError);
  });

  it("authorizeWith rejects anonymous and attaches the principal", () => {
    expect(() => authorizeWith(null, "getMe")).toThrow(ApiError);
    expect(authorizeWith(p("coach"), "getMe").principal.tenantId).toBe("t1");
  });
});
