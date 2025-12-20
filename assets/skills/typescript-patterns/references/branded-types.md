# Branded Types for Type Safety

Branded types create distinct types from primitives to prevent mixing incompatible values.

## Basic Branded Type

```typescript
type Brand<K, T> = K & { __brand: T };

type UserId = Brand<string, 'UserId'>;
type ProductId = Brand<string, 'ProductId'>;

// Constructor functions
function userId(id: string): UserId {
  return id as UserId;
}

function productId(id: string): ProductId {
  return id as ProductId;
}

// Usage
const user = userId('user-123');
const product = productId('prod-456');

function getUser(id: UserId) {
  // Implementation
}

getUser(user); // ✓ OK
getUser(product); // ✗ Type error!
```

## Validated Branded Types

Combine with validation:

```typescript
type Email = Brand<string, 'Email'>;

function email(value: string): Email {
  if (!value.includes('@')) {
    throw new Error('Invalid email');
  }
  return value as Email;
}

type PositiveNumber = Brand<number, 'Positive'>;

function positive(n: number): PositiveNumber {
  if (n <= 0) {
    throw new Error('Must be positive');
  }
  return n as PositiveNumber;
}
```

## Numeric Ranges

```typescript
type Percentage = Brand<number, 'Percentage'>; // 0-100

function percentage(n: number): Percentage {
  if (n < 0 || n > 100) {
    throw new Error('Must be between 0 and 100');
  }
  return n as Percentage;
}

type Age = Brand<number, 'Age'>; // Non-negative integer

function age(n: number): Age {
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error('Age must be non-negative integer');
  }
  return n as Age;
}
```

## ISO Date Strings

```typescript
type ISODate = Brand<string, 'ISODate'>;

function isoDate(date: Date | string): ISODate {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date');
  }
  return d.toISOString() as ISODate;
}

// API response type
interface UserResponse {
  id: UserId;
  email: Email;
  createdAt: ISODate;
}
```

## Benefits

1. **Prevent mixing incompatible values**: Can't accidentally use ProductId where UserId expected
2. **Self-documenting**: Type name conveys meaning
3. **Zero runtime cost**: Purely compile-time construct
4. **Validation at boundaries**: Constructor functions enforce invariants
