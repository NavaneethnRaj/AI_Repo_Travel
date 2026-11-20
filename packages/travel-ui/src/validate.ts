import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createParser, isElementNode } from "@openuidev/lang-core";
import type { ElementNode, LibraryJSONSchema } from "@openuidev/lang-core";
import type { z } from "zod";
import { DestinationCard, LIBRARY_VERSION, ROOT_COMPONENT, Reply, readCardProps } from "./library.js";

const schema: LibraryJSONSchema & { libraryVersion: string } = JSON.parse(readFileSync(new URL("../generated/schema.json", import.meta.url), "utf8"));
if (schema.libraryVersion !== LIBRARY_VERSION) throw new Error("OpenUI schema version mismatch");

const parser = createParser(schema, ROOT_COMPONENT);
const identifier = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const maxDepth = 8;
const maxNodes = 512;

type ErrorCode =
  | "PROGRAM_TOO_LARGE" | "LIMIT_EXCEEDED" | "INCOMPLETE" | "INVALID_SYNTAX"
  | "MISSING_ROOT" | "INVALID_ROOT" | "DUPLICATE_DEFINITION"
  | "UNKNOWN_COMPONENT" | "EXTRA_PROP" | "INVALID_PROP" | "UNKNOWN_PLACE"
  | "UNRESOLVED_REFERENCE" | "CYCLIC_REFERENCE" | "UNREACHABLE_DEFINITION" | "PARSER_REJECTED";

type Result = { ok: true; root: ElementNode } | { ok: false; code: ErrorCode };

class InvalidProgram extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

type Expression =
  | null | string | number | Expression[]
  | { reference: string }
  | { component: string; args: Expression[] };

type CardProps = z.infer<typeof DestinationCard.props>;
type ReplyProps = { children: CardProps[] };

function invalid(code: ErrorCode): never {
  throw new InvalidProgram(code);
}

function takeNode(depth: number, count: number) {
  if (depth > maxDepth || count > maxNodes) invalid("LIMIT_EXCEEDED");
}

// The vendor parser repairs incomplete programs. Require a complete literal-only
// grammar first so recovery cannot hide a token, definition, or expression.
function readDefinitions(source: string, isStreaming: boolean) {
  const tokenPattern = /[ \t\r]+|\n|[a-zA-Z_][a-zA-Z_0-9]*|-?(?:0|[1-9][0-9]*)|[=(),\[\]]/y;
  let offset = 0;
  let count = 0;
  const definitions = new Map<string, Expression>();

  function quotedString(): string {
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === '"') return source.slice(start, offset);
      if (character === "\\") offset++;
      if (character === "\n" || character === "\r") invalid("INVALID_SYNTAX");
    }
    invalid("INCOMPLETE");
  }

  function next(): string | undefined {
    while (offset < source.length) {
      if (source[offset] === '"') return quotedString();
      tokenPattern.lastIndex = offset;
      const match = tokenPattern.exec(source);
      if (!match) return source[offset++];
      offset = tokenPattern.lastIndex;
      if (!/^[ \t\r]+$/.test(match[0])) return match[0];
    }
  }

  let token = next();
  function take() {
    const value = token;
    if (value === undefined) invalid("INCOMPLETE");
    token = next();
    return value;
  }

  function expect(value: string) {
    if (take() !== value) invalid("INVALID_SYNTAX");
  }

  function lineBreaks() {
    while (token === "\n") take();
  }

  function list(close: string, depth: number): Expression[] {
    const values: Expression[] = [];
    lineBreaks();
    if (token === close) {
      take();
      return values;
    }
    for (;;) {
      values.push(expression(depth));
      lineBreaks();
      const delimiter = take();
      if (delimiter === close) return values;
      if (delimiter !== ",") invalid("INVALID_SYNTAX");
      lineBreaks();
    }
  }

  function expression(depth: number): Expression {
    takeNode(depth, ++count);
    const value = take();
    if (value === "[") return list("]", depth + 1);
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return invalid("INVALID_SYNTAX");
      }
    }
    if (/^-?\d+$/.test(value)) return Number(value);
    if (value === "-" && token === undefined) invalid("INCOMPLETE");
    if (value === "null") return null;
    if (!identifier.test(value)) invalid("INVALID_SYNTAX");
    if (token !== "(") return { reference: value };
    take();
    return { component: value, args: list(")", depth + 1) };
  }

  lineBreaks();
  while (token !== undefined) {
    const name = take();
    if (!identifier.test(name) || name === "null" || Object.hasOwn(Object.prototype, name)) invalid("INVALID_SYNTAX");
    expect("=");
    if (definitions.has(name)) invalid("DUPLICATE_DEFINITION");
    const value = expression(1);
    if (isStreaming && token === undefined && value !== null && typeof value === "object" && "reference" in value) {
      invalid("INCOMPLETE");
    }
    definitions.set(name, value);
    if (token !== undefined && token !== "\n") invalid("INVALID_SYNTAX");
    lineBreaks();
  }
  return definitions;
}

function positionalProps(shape: Record<string, unknown>, args: Expression[]) {
  const keys = Object.keys(shape);
  if (args.length > keys.length) invalid("EXTRA_PROP");
  return Object.fromEntries(keys.map((key, index) => [key, args[index]]));
}

function checkDefinitions(definitions: Map<string, Expression>, catalogue: Readonly<Record<string, string>>): ReplyProps {
  if (!definitions.has("root")) invalid("MISSING_ROOT");
  const root = definitions.get("root");
  if (root === null || typeof root !== "object" || !("component" in root) || root.component !== ROOT_COMPONENT) {
    invalid("INVALID_ROOT");
  }

  const visited = new Set(["root"]);
  const active = new Set(["root"]);
  let count = 1;

  function card(expression: Expression, depth: number): CardProps {
    takeNode(depth, ++count);
    if (expression === null || typeof expression !== "object") invalid("INVALID_PROP");
    if ("reference" in expression) {
      const name = expression.reference;
      if (active.has(name)) invalid("CYCLIC_REFERENCE");
      const target = definitions.get(name);
      if (target === undefined) invalid("UNRESOLVED_REFERENCE");
      visited.add(name);
      active.add(name);
      const result = card(target, depth + 1);
      active.delete(name);
      return result;
    }

    if (!("component" in expression)) invalid("INVALID_PROP");
    if (expression.component === ROOT_COMPONENT) invalid("INVALID_PROP");
    if (expression.component !== DestinationCard.name) invalid("UNKNOWN_COMPONENT");
    const result = readCardProps(positionalProps(DestinationCard.props.shape, expression.args));
    if (!result.success) invalid("INVALID_PROP");
    if (!Object.hasOwn(catalogue, result.data.placeId)) invalid("UNKNOWN_PLACE");
    return result.data;
  }

  const { children } = positionalProps(Reply.props.shape, root.args);
  if (!Array.isArray(children) || children.length < 1 || children.length > 24) invalid("INVALID_PROP");
  const props = { children: children.map((child: Expression) => card(child, 2)) };
  if (visited.size !== definitions.size) invalid("UNREACHABLE_DEFINITION");
  return props;
}

function parsedProps(root: ElementNode): ReplyProps {
  if (root.typeName !== ROOT_COMPONENT || root.partial || root.statementId !== "root") invalid("PARSER_REJECTED");
  const { children, ...rest } = root.props;
  if (!Array.isArray(children)) invalid("PARSER_REJECTED");

  const checked = children.map((node: unknown) => {
    if (!isElementNode(node) || node.typeName !== DestinationCard.name || node.partial) invalid("PARSER_REJECTED");
    const card = readCardProps(node.props);
    if (!card.success) invalid("PARSER_REJECTED");
    return card.data;
  });
  if (!Reply.props.safeParse({ ...rest, children: checked }).success) invalid("PARSER_REJECTED");
  return { children: checked };
}

export function validateProgram(
  source: string, catalogue: Readonly<Record<string, string>>, isStreaming = false,
): Result {
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) return { ok: false, code: "PROGRAM_TOO_LARGE" };

  try {
    const definitions = readDefinitions(source, isStreaming);
    const checked = checkDefinitions(definitions, catalogue);
    const { root, meta } = parser.parse(source);

    if (meta.incomplete || meta.unresolved.length || meta.orphaned.length || meta.errors.length
      || meta.statementCount !== definitions.size || !root || !isDeepStrictEqual(parsedProps(root), checked)) {
      invalid("PARSER_REJECTED");
    }
    return { ok: true, root };
  } catch (error) {
    const code = error instanceof InvalidProgram ? error.code : "PARSER_REJECTED";
    if (isStreaming && (code === "MISSING_ROOT" || code === "UNRESOLVED_REFERENCE")) {
      return { ok: false, code: "INCOMPLETE" };
    }
    return { ok: false, code };
  }
}
