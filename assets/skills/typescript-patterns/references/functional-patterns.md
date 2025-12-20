# Functional Programming Patterns in TypeScript

## Option/Maybe Type

Handle nullable values functionally:

```typescript
type Option<T> = Some<T> | None;

interface Some<T> {
  readonly _tag: 'Some';
  readonly value: T;
}

interface None {
  readonly _tag: 'None';
}

function some<T>(value: T): Option<T> {
  return { _tag: 'Some', value };
}

const none: Option<never> = { _tag: 'None' };

function map<A, B>(f: (a: A) => B, option: Option<A>): Option<B> {
  return option._tag === 'Some' ? some(f(option.value)) : none;
}

function flatMap<A, B>(f: (a: A) => Option<B>, option: Option<A>): Option<B> {
  return option._tag === 'Some' ? f(option.value) : none;
}
```

## Either Type

Represent success or failure:

```typescript
type Either<L, R> = Left<L> | Right<R>;

interface Left<L> {
  readonly _tag: 'Left';
  readonly left: L;
}

interface Right<R> {
  readonly _tag: 'Right';
  readonly right: R;
}

function left<L>(value: L): Either<L, never> {
  return { _tag: 'Left', left: value };
}

function right<R>(value: R): Either<never, R> {
  return { _tag: 'Right', right: value };
}

// Usage
function divide(a: number, b: number): Either<string, number> {
  return b === 0 ? left('Division by zero') : right(a / b);
}
```

## Pipe and Compose

Type-safe function composition:

```typescript
function pipe<A, B>(a: A, ab: (a: A) => B): B;
function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
function pipe<A, B, C, D>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D
): D;
function pipe(value: any, ...fns: Array<(arg: any) => any>): any {
  return fns.reduce((acc, fn) => fn(acc), value);
}

// Usage
const result = pipe(
  5,
  x => x * 2,
  x => x + 1,
  x => x.toString()
); // "11"
```

## Immutable Updates

```typescript
// Immutable array operations
function append<T>(arr: readonly T[], item: T): readonly T[] {
  return [...arr, item];
}

function remove<T>(arr: readonly T[], index: number): readonly T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

// Immutable object updates
function updateProperty<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K]
): T {
  return { ...obj, [key]: value };
}
```
