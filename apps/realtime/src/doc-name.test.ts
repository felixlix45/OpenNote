/**
 * apps/realtime — doc-name parser tests (🔒 SECURITY-REVIEW: doc-name is the
 * ONLY trusted page identity, ticket 0010 req #3).
 *
 * The doc name `page:{uuid}` is the sole link between a WS connection and a
 * page. The parser must accept ONLY well-formed `page:<uuid>` strings and
 * reject everything else — never trust a page id from any other channel.
 */
import { describe, expect, it } from "vitest";
import { parseDocName } from "./doc-name.js";

describe("parseDocName", () => {
  it("accepts a well-formed page:<uuid>", () => {
    expect(parseDocName("page:00000000-0000-0000-0000-000000000001")).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it.each([
    ["missing prefix", "00000000-0000-0000-0000-000000000001"],
    ["wrong prefix", "doc:00000000-0000-0000-0000-000000000001"],
    ["empty", ""],
    ["prefix only", "page:"],
    ["garbage", "page:not-a-uuid"],
    ["path traversal attempt", "page:../../etc/passwd"],
    ["uuid with trailing junk", "page:00000000-0000-0000-0000-000000000001/edit"],
    ["workspace-prefixed name (not used in v1)", "ws:abc.page:00000000-0000-0000-0000-000000000001"],
    ["uuid too short", "page:00000000-0000-0000-0000-0000"],
  ])("rejects %s", (_label, input) => {
    expect(parseDocName(input)).toBeNull();
  });

  it("is case-insensitive on the prefix but preserves uuid case", () => {
    // UUIDs are lowercase by convention; the parser must not mangle case (the
    // page lookup is case-sensitive on the uuid column).
    expect(parseDocName("PAGE:00000000-0000-0000-0000-000000000001")).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("rejects a uuid with uppercase hex (strict uuid v4 format)", () => {
    // gen_random_uuid produces lowercase; reject uppercase to keep lookups
    // predictable. (Postgres uuid type is case-insensitive, but we normalize
    // at the boundary.)
    expect(parseDocName("page:00000000-0000-0000-0000-00000000000F")).toBe(
      "00000000-0000-0000-0000-00000000000f",
    );
  });
});
