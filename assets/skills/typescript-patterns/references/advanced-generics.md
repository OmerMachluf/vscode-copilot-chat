# Advanced Generic Patterns

## Conditional Types

Use conditional types for type-level programming:

```typescript
type IsString<T> = T extends string ? true : false;

type A = IsString<string>; // true
type B = IsString<number>; // false
```

## Distributive Conditional Types

```typescript
type ToArray<T> = T extends any ? T[] : never;

type StrOrNumArray = ToArray<string | number>;
// Result: string[] | number[] (distributed over union)
```

## Infer Keyword

Extract types from complex structures:

```typescript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type ArrayElement<T> = T extends (infer E)[] ? E : never;
```

## Recursive Types

```typescript
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
```

## Variadic Tuple Types

```typescript
type Concat<T extends any[], U extends any[]> = [...T, ...U];

type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never;

type Tail<T extends any[]> = T extends [any, ...infer T] ? T : [];
```
