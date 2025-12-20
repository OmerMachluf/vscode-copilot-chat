---
name: typescript-patterns
description: Modern TypeScript patterns, best practices, and advanced type system features for writing type-safe, maintainable code
keywords: typescript, types, generics, type safety, patterns, advanced types
---

This skill covers modern TypeScript patterns and best practices for writing type-safe, maintainable code.

## Type Safety Fundamentals

### Avoid `any`

**Bad**:
```typescript
function processData(data: any): any {
  return data.value;
}
```

**Good**:
```typescript
function processData<T extends { value: unknown }>(data: T): T['value'] {
  return data.value;
}
```

### Use `unknown` for truly unknown types

```typescript
// When you don't know the type, use unknown and narrow it
function safeParse(json: string): unknown {
  return JSON.parse(json);
}

function handleData(data: unknown) {
  if (typeof data === 'string') {
    console.log(data.toUpperCase()); // TypeScript knows it's a string
  }
}
```

## Advanced Type Patterns

### Discriminated Unions

Model state machines and variants clearly:

```typescript
type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

function handleResult<T>(result: Result<T>) {
  if (result.success) {
    console.log(result.value); // TypeScript knows value exists
  } else {
    console.error(result.error); // TypeScript knows error exists
  }
}
```

### Utility Types

Leverage built-in utility types:

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  password: string;
}

// Pick subset of properties
type PublicUser = Pick<User, 'id' | 'name'>;

// Omit sensitive properties
type SafeUser = Omit<User, 'password'>;

// Make all properties optional
type PartialUser = Partial<User>;

// Make all properties required
type RequiredUser = Required<Partial<User>>;

// Make all properties readonly
type ImmutableUser = Readonly<User>;
```

### Mapped Types

Transform types systematically:

```typescript
// Make all properties nullable
type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

// Make properties deep readonly
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object
    ? DeepReadonly<T[K]>
    : T[K];
};

// Extract function property names
type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];
```

### Template Literal Types

Type-safe string manipulation:

```typescript
type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Endpoint = `/api/${string}`;

type Route = `${HTTPMethod} ${Endpoint}`;
// Result: "GET /api/..." | "POST /api/..." | etc.

// Type-safe event names
type EventName<T extends string> = `on${Capitalize<T>}`;
type ClickEvent = EventName<'click'>; // "onClick"
```

## Generics Best Practices

### Generic Constraints

```typescript
// Constrain to objects with specific properties
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Constrain to constructable types
function createInstance<T>(Constructor: new () => T): T {
  return new Constructor();
}

// Multiple type parameters with constraints
function merge<T extends object, U extends object>(obj1: T, obj2: U): T & U {
  return { ...obj1, ...obj2 };
}
```

### Generic Defaults

```typescript
interface Response<T = unknown> {
  data: T;
  status: number;
}

// Can be used without type parameter
const response: Response = { data: {}, status: 200 };

// Or with explicit type
const userResponse: Response<User> = { data: user, status: 200 };
```

## Dependency Injection Pattern

Type-safe DI for testability:

```typescript
// Define service interfaces
interface IUserRepository {
  findById(id: string): Promise<User | undefined>;
  save(user: User): Promise<void>;
}

interface IEmailService {
  sendWelcome(email: string): Promise<void>;
}

// Implementation uses constructor injection
class UserService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly emailService: IEmailService
  ) {}

  async registerUser(user: User): Promise<void> {
    await this.userRepo.save(user);
    await this.emailService.sendWelcome(user.email);
  }
}

// Easy to test with mocks
const mockRepo: IUserRepository = {
  findById: vi.fn(),
  save: vi.fn()
};
const service = new UserService(mockRepo, mockEmailService);
```

## Strict Null Checking

Always enable `strictNullChecks` in tsconfig.json:

```typescript
// Without strict null checks (dangerous)
function getLength(str: string): number {
  return str.length; // Runtime error if str is null
}

// With strict null checks (safe)
function getLength(str: string | null): number {
  if (str === null) {
    return 0;
  }
  return str.length; // TypeScript knows str is not null
}

// Or use optional chaining
function getLength(str: string | null): number {
  return str?.length ?? 0;
}
```

## Type Guards

Create type-safe runtime checks:

```typescript
// User-defined type guard
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value
  );
}

// Use in code
function handleData(data: unknown) {
  if (isUser(data)) {
    console.log(data.name); // TypeScript knows it's a User
  }
}

// Array type guard
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
```

## Const Assertions

Narrow types to literal values:

```typescript
// Without const assertion
const config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000
};
// Type: { apiUrl: string; timeout: number }

// With const assertion
const config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000
} as const;
// Type: { readonly apiUrl: 'https://api.example.com'; readonly timeout: 5000 }

// Useful for enums
const COLORS = ['red', 'green', 'blue'] as const;
type Color = typeof COLORS[number]; // 'red' | 'green' | 'blue'
```

## Builder Pattern with Fluent API

Type-safe builder pattern:

```typescript
class QueryBuilder<T> {
  private filters: Array<(item: T) => boolean> = [];

  where(predicate: (item: T) => boolean): this {
    this.filters.push(predicate);
    return this;
  }

  execute(data: T[]): T[] {
    return data.filter(item => this.filters.every(f => f(item)));
  }
}

// Usage
const results = new QueryBuilder<User>()
  .where(u => u.age > 18)
  .where(u => u.active)
  .execute(users);
```

## Exhaustiveness Checking

Ensure all cases are handled:

```typescript
type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'square'; size: number }
  | { kind: 'rectangle'; width: number; height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius ** 2;
    case 'square':
      return shape.size ** 2;
    case 'rectangle':
      return shape.width * shape.height;
    default:
      const _exhaustive: never = shape;
      throw new Error(`Unhandled shape: ${_exhaustive}`);
  }
}
```

## Async/Promise Types

Type async operations correctly:

```typescript
// Return Promise<T> for async functions
async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

// Handle multiple async operations
async function loadData(): Promise<[User[], Post[]]> {
  const [users, posts] = await Promise.all([
    fetchUsers(),
    fetchPosts()
  ]);
  return [users, posts];
}

// Type-safe error handling
type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

async function safeOperation(): AsyncResult<User> {
  try {
    const user = await fetchUser('123');
    return { success: true, value: user };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}
```

## Configuration

Recommended `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

For more advanced patterns, see the reference documents in this skill's `references/` directory.
