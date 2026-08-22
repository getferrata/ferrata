import { describe, expect, it } from "vitest";
import { isWellKnownAddress } from "@/lib/sources/well-known";
import { assertNoProtectedValues } from "@/lib/package/format";
import type { FerrataPackage } from "@/lib/package/format";

describe("isWellKnownAddress", () => {
  it("lets the three private blocks through", () => {
    // A module called "Private addresses and NAT (RFC1918)" is about these
    // three numbers. Protecting them protects nothing and breaks the course.
    for (const v of ["10.0.0.0", "172.16.0.0", "192.168.0.0"]) {
      expect(isWellKnownAddress(v), v).toBe(true);
    }
  });

  it("still protects a host inside one of those blocks", () => {
    // The block base is fixed by an RFC. A host inside it is somebody's
    // machine, and being a common example is not a reason to stop.
    for (const v of ["10.20.34.7", "192.168.1.1", "172.16.4.9", "10.0.0.1"]) {
      expect(isWellKnownAddress(v), v).toBe(false);
    }
  });

  it("lets every address in the documentation ranges through", () => {
    // RFC 5737 reserves these precisely so people can write about networks.
    for (const v of ["192.0.2.1", "192.0.2.254", "198.51.100.7", "203.0.113.42"]) {
      expect(isWellKnownAddress(v), v).toBe(true);
    }
    expect(isWellKnownAddress("2001:db8::1")).toBe(true);
  });

  it("does not let a neighbour of a documentation range through", () => {
    for (const v of ["192.0.3.1", "198.51.101.7", "203.0.114.42"]) {
      expect(isWellKnownAddress(v), v).toBe(false);
    }
  });

  it("takes the addresses that mean nowhere, here and everyone", () => {
    for (const v of ["0.0.0.0", "127.0.0.1", "255.255.255.255", "::1"]) {
      expect(isWellKnownAddress(v), v).toBe(true);
    }
  });

  it("takes a netmask, which is a shape rather than a place", () => {
    expect(isWellKnownAddress("255.255.255.0")).toBe(true);
  });

  it("is not fooled by spacing or case", () => {
    expect(isWellKnownAddress("  10.0.0.0 ")).toBe(true);
    expect(isWellKnownAddress("2001:DB8::5")).toBe(true);
  });

  it("says no to an empty value", () => {
    // openSecret returns "" for a sealed row with no key. That is an unknown,
    // not a published constant, and must not be waved through.
    expect(isWellKnownAddress("")).toBe(false);
    expect(isWellKnownAddress("   ")).toBe(false);
  });
});

/** The smallest package the guard will look at. */
function pkgWith(bodyMd: string): FerrataPackage {
  return {
    manifest: {
      format: "ferrata",
      version: 1,
      title: "T",
      author: null,
      lang: "it",
      license: null,
      sourceHash: "h",
      exportedAt: 0,
      moduleCount: 1,
    },
    context: "",
    objective: null,
    domain: null,
    concretenessRule: null,
    startLevel: null,
    scheduleMd: null,
    glossaryMd: null,
    budgetMinutes: null,
    graph: { concepts: [], edges: [] },
    modules: [{ conceptId: "c1", title: "M", kind: "concept", bodyMd }],
    questions: [],
    cuts: [],
  };
}

describe("assertNoProtectedValues", () => {
  it("refuses a package carrying a real address in clear", () => {
    expect(() =>
      assertNoProtectedValues(pkgWith("The core sits on 10.20.34.7 today."), [
        { value: "10.20.34.7", label: "Private IP address" },
      ]),
    ).toThrow(/Private IP address/);
  });

  it("lets a textbook address through, without a rebuild", () => {
    // This is the case that matters for a course already built: it carries the
    // tokens and the restore map from before the allowlist existed, and paying
    // to write it again is not a fix.
    expect(() =>
      assertNoProtectedValues(
        pkgWith("I tre blocchi privati sono 10.0.0.0, 172.16.0.0 e 192.168.0.0."),
        [
          { value: "10.0.0.0", label: "Private IP address" },
          { value: "172.16.0.0", label: "Private IP address" },
          { value: "192.168.0.0", label: "Private IP address" },
        ],
      ),
    ).not.toThrow();
  });

  it("still refuses when a real value hides among textbook ones", () => {
    expect(() =>
      assertNoProtectedValues(
        pkgWith("Da 10.0.0.0 in giù, ma il nostro è 10.20.34.7."),
        [
          { value: "10.0.0.0", label: "Private IP address" },
          { value: "10.20.34.7", label: "Internal hostname" },
        ],
      ),
    ).toThrow(/Internal hostname/);
  });

  it("says nothing when the course has no protected values at all", () => {
    expect(() => assertNoProtectedValues(pkgWith("Plain text."), [])).not.toThrow();
  });
});
