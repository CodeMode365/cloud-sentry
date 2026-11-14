import type { NativeAttributeValue } from '@aws-sdk/lib-dynamodb';

/** Accumulates a DynamoDB FilterExpression with safe placeholder names. */
export class FilterBuilder {
  private readonly parts: string[] = [];
  readonly names: Record<string, string> = {};
  readonly values: Record<string, NativeAttributeValue> = {};
  private n = 0;

  private name(field: string): string {
    const key = `#x${this.n++}`;
    this.names[key] = field;
    return key;
  }
  private value(v: NativeAttributeValue): string {
    const key = `:x${this.n++}`;
    this.values[key] = v;
    return key;
  }

  eq(field: string, v: NativeAttributeValue | undefined): this {
    if (v === undefined) return this;
    this.parts.push(`${this.name(field)} = ${this.value(v)}`);
    return this;
  }
  ne(field: string, v: NativeAttributeValue): this {
    this.parts.push(`${this.name(field)} <> ${this.value(v)}`);
    return this;
  }
  gte(field: string, v: number | undefined): this {
    if (v === undefined) return this;
    this.parts.push(`${this.name(field)} >= ${this.value(v)}`);
    return this;
  }
  gt(field: string, v: number): this {
    this.parts.push(`${this.name(field)} > ${this.value(v)}`);
    return this;
  }
  in(field: string, list: readonly NativeAttributeValue[] | undefined): this {
    if (!list || list.length === 0) return this;
    const n = this.name(field);
    this.parts.push(`${n} IN (${list.map((v) => this.value(v)).join(', ')})`);
    return this;
  }
  contains(field: string, v: string | undefined): this {
    if (!v) return this;
    this.parts.push(`contains(${this.name(field)}, ${this.value(v)})`);
    return this;
  }

  build():
    | { expression: string; names: Record<string, string>; values: Record<string, NativeAttributeValue> }
    | undefined {
    if (this.parts.length === 0) return undefined;
    return { expression: this.parts.join(' AND '), names: this.names, values: this.values };
  }
}
