/**
 * `Map` com os utilitários que a comunidade de bots usa em caches (`filter`, `map`, `find`, `first`, `random`…).
 * Todos os caches do SDK (`guilds.cache`, `members.cache`, `message.attachments`…) são `Collection`.
 */
export class Collection<K, V> extends Map<K, V> {
  /** o primeiro valor (ou os `n` primeiros) */
  first(): V | undefined;
  first(n: number): V[];
  first(n?: number): V | V[] | undefined {
    if (n === undefined) return this.values().next().value;
    return [...this.values()].slice(0, Math.max(0, n));
  }
  /** o último valor (ou os `n` últimos) */
  last(): V | undefined;
  last(n: number): V[];
  last(n?: number): V | V[] | undefined {
    const arr = [...this.values()];
    if (n === undefined) return arr[arr.length - 1];
    return n <= 0 ? [] : arr.slice(-n);
  }
  firstKey(): K | undefined {
    return this.keys().next().value;
  }
  lastKey(): K | undefined {
    const arr = [...this.keys()];
    return arr[arr.length - 1];
  }
  /** valor na posição (negativa conta do fim) */
  at(index: number): V | undefined {
    return [...this.values()].at(index);
  }
  keyAt(index: number): K | undefined {
    return [...this.keys()].at(index);
  }
  /** um valor ao acaso (ou `n` valores distintos) */
  random(): V | undefined;
  random(n: number): V[];
  random(n?: number): V | V[] | undefined {
    const arr = [...this.values()];
    if (n === undefined) return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
    const out: V[] = [];
    const want = Math.min(n, arr.length);
    while (out.length < want) out.push(arr.splice(Math.floor(Math.random() * arr.length), 1)[0]!);
    return out;
  }
  find(fn: (value: V, key: K, collection: this) => boolean): V | undefined {
    for (const [k, v] of this) if (fn(v, k, this)) return v;
    return undefined;
  }
  findKey(fn: (value: V, key: K, collection: this) => boolean): K | undefined {
    for (const [k, v] of this) if (fn(v, k, this)) return k;
    return undefined;
  }
  filter(fn: (value: V, key: K, collection: this) => boolean): Collection<K, V> {
    const out = new Collection<K, V>();
    for (const [k, v] of this) if (fn(v, k, this)) out.set(k, v);
    return out;
  }
  /** dois conjuntos: os que passam no filtro e os que não passam */
  partition(fn: (value: V, key: K, collection: this) => boolean): [Collection<K, V>, Collection<K, V>] {
    const yes = new Collection<K, V>();
    const no = new Collection<K, V>();
    for (const [k, v] of this) (fn(v, k, this) ? yes : no).set(k, v);
    return [yes, no];
  }
  map<T>(fn: (value: V, key: K, collection: this) => T): T[] {
    const out: T[] = [];
    for (const [k, v] of this) out.push(fn(v, k, this));
    return out;
  }
  mapValues<T>(fn: (value: V, key: K, collection: this) => T): Collection<K, T> {
    const out = new Collection<K, T>();
    for (const [k, v] of this) out.set(k, fn(v, k, this));
    return out;
  }
  flatMap<T>(fn: (value: V, key: K, collection: this) => Iterable<T>): T[] {
    const out: T[] = [];
    for (const [k, v] of this) out.push(...fn(v, k, this));
    return out;
  }
  some(fn: (value: V, key: K, collection: this) => boolean): boolean {
    for (const [k, v] of this) if (fn(v, k, this)) return true;
    return false;
  }
  every(fn: (value: V, key: K, collection: this) => boolean): boolean {
    for (const [k, v] of this) if (!fn(v, k, this)) return false;
    return true;
  }
  reduce<T>(fn: (acc: T, value: V, key: K, collection: this) => T, initial: T): T {
    let acc = initial;
    for (const [k, v] of this) acc = fn(acc, v, k, this);
    return acc;
  }
  each(fn: (value: V, key: K, collection: this) => void): this {
    for (const [k, v] of this) fn(v, k, this);
    return this;
  }
  tap(fn: (collection: this) => void): this {
    fn(this);
    return this;
  }
  /** remove os que passam no filtro; devolve quantos saíram */
  sweep(fn: (value: V, key: K, collection: this) => boolean): number {
    const before = this.size;
    for (const [k, v] of [...this]) if (fn(v, k, this)) this.delete(k);
    return before - this.size;
  }
  /** devolve o valor da chave, criando-o com `make` se não existir */
  ensure(key: K, make: (key: K, collection: this) => V): V {
    if (this.has(key)) return this.get(key) as V;
    const v = make(key, this);
    this.set(key, v);
    return v;
  }
  hasAll(...keys: K[]): boolean {
    return keys.every((k) => this.has(k));
  }
  hasAny(...keys: K[]): boolean {
    return keys.some((k) => this.has(k));
  }
  clone(): Collection<K, V> {
    return new Collection<K, V>(this);
  }
  concat(...collections: ReadonlyMap<K, V>[]): Collection<K, V> {
    const out = this.clone();
    for (const c of collections) for (const [k, v] of c) out.set(k, v);
    return out;
  }
  equals(other: ReadonlyMap<K, V>): boolean {
    if (this.size !== other.size) return false;
    for (const [k, v] of this) if (!other.has(k) || other.get(k) !== v) return false;
    return true;
  }
  /** chaves que só existem em um dos dois */
  difference(other: ReadonlyMap<K, V>): Collection<K, V> {
    const out = new Collection<K, V>();
    for (const [k, v] of other) if (!this.has(k)) out.set(k, v);
    for (const [k, v] of this) if (!other.has(k)) out.set(k, v);
    return out;
  }
  intersect(other: ReadonlyMap<K, V>): Collection<K, V> {
    const out = new Collection<K, V>();
    for (const [k, v] of this) if (other.has(k)) out.set(k, v);
    return out;
  }
  /** ordena no lugar (padrão: ordem natural das chaves) */
  sort(compare: (a: V, b: V, ka: K, kb: K) => number = (a, b) => (a < b ? -1 : a > b ? 1 : 0)): this {
    const entries = [...this.entries()].sort(([ka, a], [kb, b]) => compare(a, b, ka, kb));
    super.clear();
    for (const [k, v] of entries) super.set(k, v);
    return this;
  }
  /** cópia ordenada */
  sorted(compare?: (a: V, b: V, ka: K, kb: K) => number): Collection<K, V> {
    return this.clone().sort(compare);
  }
  toJSON(): V[] {
    return [...this.values()];
  }
  override get [Symbol.toStringTag]() {
    return 'Collection';
  }
}
