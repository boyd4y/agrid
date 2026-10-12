/**
 * Feishu-like formula engine (shared by UI, server, agents).
 *
 * Syntax:
 *   {Column Name} or {column-uuid}  — cell ref
 *   numbers, "strings", true/false
 *   + - * /   & (concat)   = != > >= < <=
 *   IF(cond, a, b) AND(...) OR(...) NOT(x)
 *   CONCAT(...) LEN(x) ABS(x) ROUND(x[, n]) EMPTY(x) VALUE(x) TEXT(x)
 *
 * Computed values are stored on the row so filters/sorts/agents see them.
 */
import type {
  CellValue,
  ColumnConfig,
  ColumnDef,
  ColumnType,
  FormulaResultType,
} from "./types.js";

export type { FormulaResultType };

export type FormulaEvalResult = {
  value: CellValue;
  error?: string;
};

const REF_RE = /\{([^{}]+)\}/g;

/** Extract dependency tokens (column names or ids) from a formula string. */
export function extractFormulaDeps(formula: string): string[] {
  const deps: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(REF_RE.source, "g");
  while ((m = re.exec(formula)) !== null) {
    const token = m[1].trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    deps.push(token);
  }
  return deps;
}

function resolveRef(
  token: string,
  columns: ColumnDef[],
  cells: Record<string, CellValue>
): { columnId: string; value: CellValue; type: string } | null {
  const byId = columns.find((c) => c.id === token);
  if (byId) {
    return { columnId: byId.id, value: cells[byId.id] ?? null, type: byId.type };
  }
  const byName = columns.find((c) => c.name === token);
  if (byName) {
    return {
      columnId: byName.id,
      value: cells[byName.id] ?? null,
      type: byName.type,
    };
  }
  return null;
}

/** Map dep tokens → column ids; returns null for unknown refs. */
export function resolveFormulaDepIds(
  formula: string,
  columns: ColumnDef[]
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const token of extractFormulaDeps(formula)) {
    const r = resolveRef(token, columns, {});
    if (!r) {
      unknown.push(token);
      continue;
    }
    if (!seen.has(r.columnId)) {
      seen.add(r.columnId);
      ids.push(r.columnId);
    }
  }
  return { ids, unknown };
}

export function validateFormula(
  formula: string,
  columns: ColumnDef[],
  selfColumnId?: string
): string | null {
  const trimmed = formula?.trim();
  if (!trimmed) return "公式不能为空";
  const { unknown, ids } = resolveFormulaDepIds(trimmed, columns);
  if (unknown.length) return `未知列引用: ${unknown.join(", ")}`;
  if (selfColumnId && ids.includes(selfColumnId)) {
    return "公式不能引用自身";
  }
  // dry-run eval with empty cells to catch syntax errors
  const dry = evaluateFormula(trimmed, columns, {}, { selfColumnId });
  if (dry.error && dry.error.startsWith("语法")) return dry.error;
  // circular among formulas checked separately
  return null;
}

/** Topological order of formula columns; throws on cycle. */
export function sortFormulaColumns(columns: ColumnDef[]): ColumnDef[] {
  const formulas = columns.filter((c) => c.type === "formula");
  const idToCol = new Map(columns.map((c) => [c.id, c]));
  const deps = new Map<string, string[]>();
  for (const f of formulas) {
    const expr = f.config?.formula ?? "";
    const { ids } = resolveFormulaDepIds(expr, columns);
    // only formula→formula edges matter for ordering
    deps.set(
      f.id,
      ids.filter((id) => idToCol.get(id)?.type === "formula")
    );
  }
  const sorted: ColumnDef[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(id: string) {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`公式循环依赖: ${id}`);
    visiting.add(id);
    for (const d of deps.get(id) ?? []) visit(d);
    visiting.delete(id);
    done.add(id);
    const col = idToCol.get(id);
    if (col) sorted.push(col);
  }

  for (const f of formulas) visit(f.id);
  return sorted;
}

/**
 * Recompute all formula cells for one row.
 * Returns a new cells object (always a copy if any formula exists).
 */
export function recomputeRowFormulas(
  columns: ColumnDef[],
  cells: Record<string, CellValue>
): Record<string, CellValue> {
  const formulas = columns.filter((c) => c.type === "formula");
  if (!formulas.length) return cells;

  let ordered: ColumnDef[];
  try {
    ordered = sortFormulaColumns(columns);
  } catch {
    // on cycle, still evaluate in sortOrder and stamp errors
    ordered = [...formulas].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const next = { ...cells };
  for (const col of ordered) {
    const expr = col.config?.formula ?? "";
    if (!expr.trim()) {
      next[col.id] = null;
      continue;
    }
    const result = evaluateFormula(expr, columns, next, {
      selfColumnId: col.id,
      resultType: col.config?.formulaResultType,
    });
    next[col.id] = result.error ? `#ERR:${result.error}` : result.value;
  }
  return next;
}

type EvalOpts = {
  selfColumnId?: string;
  resultType?: FormulaResultType;
};

/* ───────────── Lexer / Parser / Eval ───────────── */

type Tok =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; v: string }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "comma" }
  | { k: "eof" };

function tokenize(src: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "{") {
      const end = s.indexOf("}", i);
      if (end < 0) throw new Error("语法错误: 未闭合的 {");
      tokens.push({ k: "ref", v: s.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = "";
      while (j < s.length && s[j] !== quote) {
        if (s[j] === "\\" && j + 1 < s.length) {
          out += s[j + 1];
          j += 2;
          continue;
        }
        out += s[j++];
      }
      if (j >= s.length) throw new Error("语法错误: 未闭合的字符串");
      tokens.push({ k: "str", v: out });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const n = Number(s.slice(i, j));
      if (Number.isNaN(n)) throw new Error(`语法错误: 无效数字 ${s.slice(i, j)}`);
      tokens.push({ k: "num", v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_\u4e00-\u9fff]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_\u4e00-\u9fff]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === "true") tokens.push({ k: "bool", v: true });
      else if (lower === "false") tokens.push({ k: "bool", v: false });
      else tokens.push({ k: "id", v: word });
      i = j;
      continue;
    }
    if (c === "(") {
      tokens.push({ k: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ k: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ k: "comma" });
      i++;
      continue;
    }
    // multi-char ops
    const two = s.slice(i, i + 2);
    if ([">=", "<=", "!=", "==", "<>"].includes(two)) {
      tokens.push({ k: "op", v: two === "==" ? "=" : two === "<>" ? "!=" : two });
      i += 2;
      continue;
    }
    if ("+-*/&<>=!".includes(c)) {
      tokens.push({ k: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`语法错误: 意外字符 '${c}'`);
  }
  tokens.push({ k: "eof" });
  return tokens;
}

type Ctx = {
  columns: ColumnDef[];
  cells: Record<string, CellValue>;
  selfColumnId?: string;
};

class Parser {
  private i = 0;
  constructor(
    private tokens: Tok[],
    private ctx: Ctx
  ) {}

  private peek(): Tok {
    return this.tokens[this.i] ?? { k: "eof" };
  }
  private next(): Tok {
    return this.tokens[this.i++] ?? { k: "eof" };
  }
  private expect(k: Tok["k"]): Tok {
    const t = this.next();
    if (t.k !== k) throw new Error(`语法错误: 期望 ${k}`);
    return t;
  }

  parse(): CellValue {
    const v = this.parseOr();
    if (this.peek().k !== "eof") throw new Error("语法错误: 多余内容");
    return v;
  }

  private parseOr(): CellValue {
    let left = this.parseAnd();
    while (this.peek().k === "id" && (this.peek() as { v: string }).v.toLowerCase() === "or") {
      this.next();
      const right = this.parseAnd();
      left = truthy(left) || truthy(right);
    }
    return left;
  }

  private parseAnd(): CellValue {
    let left = this.parseCompare();
    while (this.peek().k === "id" && (this.peek() as { v: string }).v.toLowerCase() === "and") {
      this.next();
      const right = this.parseCompare();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  private parseCompare(): CellValue {
    let left = this.parseConcat();
    const t = this.peek();
    if (t.k === "op" && ["=", "!=", ">", ">=", "<", "<="].includes(t.v)) {
      this.next();
      const right = this.parseConcat();
      return compare(left, t.v, right);
    }
    return left;
  }

  private parseConcat(): CellValue {
    let left = this.parseAdd();
    while (this.peek().k === "op" && (this.peek() as { v: string }).v === "&") {
      this.next();
      const right = this.parseAdd();
      left = String(cellToText(left)) + String(cellToText(right));
    }
    return left;
  }

  private parseAdd(): CellValue {
    let left = this.parseMul();
    while (this.peek().k === "op" && ["+", "-"].includes((this.peek() as { v: string }).v)) {
      const op = (this.next() as { v: string }).v;
      const right = this.parseMul();
      if (op === "+") {
        // number add if both numeric, else concat-like Feishu sometimes does — we prefer numeric
        if (isNumeric(left) && isNumeric(right)) left = toNum(left) + toNum(right);
        else left = String(cellToText(left)) + String(cellToText(right));
      } else {
        left = toNum(left) - toNum(right);
      }
    }
    return left;
  }

  private parseMul(): CellValue {
    let left = this.parseUnary();
    while (this.peek().k === "op" && ["*", "/"].includes((this.peek() as { v: string }).v)) {
      const op = (this.next() as { v: string }).v;
      const right = this.parseUnary();
      if (op === "*") left = toNum(left) * toNum(right);
      else {
        const d = toNum(right);
        left = d === 0 ? null : toNum(left) / d;
      }
    }
    return left;
  }

  private parseUnary(): CellValue {
    if (this.peek().k === "op" && (this.peek() as { v: string }).v === "-") {
      this.next();
      return -toNum(this.parseUnary());
    }
    if (this.peek().k === "op" && (this.peek() as { v: string }).v === "+") {
      this.next();
      return toNum(this.parseUnary());
    }
    if (this.peek().k === "id" && (this.peek() as { v: string }).v.toLowerCase() === "not") {
      this.next();
      return !truthy(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): CellValue {
    const t = this.peek();
    if (t.k === "num") {
      this.next();
      return t.v;
    }
    if (t.k === "str") {
      this.next();
      return t.v;
    }
    if (t.k === "bool") {
      this.next();
      return t.v;
    }
    if (t.k === "ref") {
      this.next();
      if (this.ctx.selfColumnId) {
        const r = resolveRef(t.v, this.ctx.columns, this.ctx.cells);
        if (r && r.columnId === this.ctx.selfColumnId) {
          throw new Error("公式不能引用自身");
        }
      }
      const r = resolveRef(t.v, this.ctx.columns, this.ctx.cells);
      if (!r) throw new Error(`未知列引用: ${t.v}`);
      return normalizeRefValue(r.value);
    }
    if (t.k === "id") {
      this.next();
      const name = t.v.toUpperCase();
      this.expect("lp");
      const args: CellValue[] = [];
      if (this.peek().k !== "rp") {
        args.push(this.parseOr());
        while (this.peek().k === "comma") {
          this.next();
          args.push(this.parseOr());
        }
      }
      this.expect("rp");
      return callFn(name, args);
    }
    if (t.k === "lp") {
      this.next();
      const v = this.parseOr();
      this.expect("rp");
      return v;
    }
    throw new Error("语法错误: 期望表达式");
  }
}

function callFn(name: string, args: CellValue[]): CellValue {
  switch (name) {
    case "IF":
      if (args.length < 2) throw new Error("IF 需要 2–3 个参数");
      return truthy(args[0]) ? args[1] : (args[2] ?? null);
    case "AND":
      return args.every(truthy);
    case "OR":
      return args.some(truthy);
    case "NOT":
      return !truthy(args[0]);
    case "CONCAT":
      return args.map(cellToText).join("");
    case "LEN":
      return String(cellToText(args[0] ?? "")).length;
    case "ABS":
      return Math.abs(toNum(args[0]));
    case "ROUND": {
      const n = toNum(args[0]);
      const d = args[1] != null ? toNum(args[1]) : 0;
      const f = 10 ** d;
      return Math.round(n * f) / f;
    }
    case "EMPTY":
      return isEmptyVal(args[0]);
    case "VALUE":
      return toNum(args[0]);
    case "TEXT":
      return cellToText(args[0]);
    default:
      throw new Error(`未知函数: ${name}`);
  }
}

function isEmptyVal(v: CellValue): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

function truthy(v: CellValue): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string" && v.startsWith("#ERR:")) return false;
  return true;
}

function isNumeric(v: CellValue): boolean {
  if (typeof v === "number" && !Number.isNaN(v)) return true;
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return true;
  return false;
}

function toNum(v: CellValue): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isNaN(v) ? 0 : v;
  if (Array.isArray(v)) return v.length;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function cellToText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.join(",");
  return String(v);
}

function normalizeRefValue(v: CellValue): CellValue {
  if (typeof v === "string" && v.startsWith("#ERR:")) return null;
  return v;
}

function compare(a: CellValue, op: string, b: CellValue): boolean {
  if (isNumeric(a) && isNumeric(b)) {
    const x = toNum(a);
    const y = toNum(b);
    switch (op) {
      case "=":
        return x === y;
      case "!=":
        return x !== y;
      case ">":
        return x > y;
      case ">=":
        return x >= y;
      case "<":
        return x < y;
      case "<=":
        return x <= y;
    }
  }
  const x = cellToText(a);
  const y = cellToText(b);
  switch (op) {
    case "=":
      return x === y;
    case "!=":
      return x !== y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
    case "<":
      return x < y;
    case "<=":
      return x <= y;
  }
  return false;
}

function coerceResult(value: CellValue, resultType?: FormulaResultType): CellValue {
  if (resultType === "number") {
    if (value === null || value === undefined || value === "") return null;
    const n = toNum(value);
    return Number.isNaN(n) ? null : n;
  }
  if (resultType === "checkbox") return truthy(value);
  if (resultType === "date") {
    const s = cellToText(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s || null;
  }
  if (resultType === "text") return cellToText(value);
  // auto: keep as-is (numbers stay numbers)
  return value;
}

export function evaluateFormula(
  formula: string,
  columns: ColumnDef[],
  cells: Record<string, CellValue>,
  opts: EvalOpts = {}
): FormulaEvalResult {
  try {
    const tokens = tokenize(formula);
    const parser = new Parser(tokens, {
      columns,
      cells,
      selfColumnId: opts.selfColumnId,
    });
    const raw = parser.parse();
    return { value: coerceResult(raw, opts.resultType) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { value: null, error: msg };
  }
}

/** Whether a column type is formula (read-only computed). */
export function isFormulaColumn(type: ColumnType | string): boolean {
  return type === "formula";
}

export function getFormulaConfig(config?: ColumnConfig | null): {
  formula: string;
  formulaResultType: FormulaResultType;
} {
  return {
    formula: config?.formula ?? "",
    formulaResultType: config?.formulaResultType ?? "auto",
  };
}
