---
name: testing-best-practices
description: Comprehensive guide to writing effective unit, integration, and end-to-end tests with modern testing frameworks
keywords: testing, unit tests, integration tests, e2e, test-driven development, TDD, mocking, assertions
---

This skill provides guidance on writing high-quality, maintainable tests across all levels of the testing pyramid.

## Testing Pyramid

```
        /\
       /E2E\       (Few)
      /------\
     /  Inte- \
    /  gration \   (Some)
   /------------\
  /  Unit Tests  \  (Many)
 /----------------\
```

**Unit Tests**: Test individual functions/classes in isolation
**Integration Tests**: Test how components work together
**E2E Tests**: Test complete user workflows through the UI/API

## Unit Testing Best Practices

### The AAA Pattern

Structure tests with Arrange-Act-Assert:

```typescript
it('should calculate total price with tax', () => {
  // Arrange: Set up test data
  const cart = new ShoppingCart();
  cart.addItem({ price: 100, quantity: 2 });

  // Act: Execute the behavior
  const total = cart.calculateTotal(0.08); // 8% tax

  // Assert: Verify the outcome
  expect(total).toBe(216); // 200 + 16 tax
});
```

### Test Naming

Use descriptive names that explain:
1. What is being tested
2. Under what conditions
3. What the expected outcome is

**Good**:
```typescript
it('should throw ValidationError when email format is invalid', () => {})
it('should return empty array when no items match filter', () => {})
it('should retry failed requests up to 3 times', () => {})
```

**Bad**:
```typescript
it('works', () => {})
it('test email', () => {})
it('should return correct value', () => {})
```

### One Assertion Per Test (Generally)

Focus each test on a single behavior:

**Good**:
```typescript
it('should add item to cart', () => {
  cart.addItem(item);
  expect(cart.items).toContain(item);
});

it('should increment total count when adding item', () => {
  cart.addItem(item);
  expect(cart.itemCount).toBe(1);
});
```

**Acceptable** (related assertions):
```typescript
it('should create valid user object', () => {
  const user = createUser('John', 'john@example.com');
  expect(user.name).toBe('John');
  expect(user.email).toBe('john@example.com');
  expect(user.id).toBeDefined();
});
```

### Test Independence

Each test should be independent and isolated:

```typescript
describe('UserService', () => {
  let userService: UserService;

  beforeEach(() => {
    // Fresh instance for each test
    userService = new UserService();
  });

  it('should create user', () => {
    const user = userService.create('John');
    expect(user.name).toBe('John');
  });

  it('should delete user', () => {
    const user = userService.create('John');
    userService.delete(user.id);
    expect(userService.find(user.id)).toBeUndefined();
  });
});
```

### Mocking Best Practices

Mock external dependencies, not the code under test:

```typescript
// Good: Mock external API
it('should fetch user data from API', async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ id: 1, name: 'John' })
  });
  global.fetch = mockFetch;

  const user = await userService.getUser(1);

  expect(mockFetch).toHaveBeenCalledWith('/api/users/1');
  expect(user.name).toBe('John');
});

// Bad: Over-mocking makes test meaningless
it('should calculate total', () => {
  const mockCalculate = vi.fn().mockReturnValue(100);
  calculator.calculate = mockCalculate;

  expect(calculator.calculate()).toBe(100); // Testing the mock, not the code
});
```

### Test Edge Cases

Cover boundary conditions and error scenarios:

```typescript
describe('divide', () => {
  it('should divide positive numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('should handle division by zero', () => {
    expect(() => divide(10, 0)).toThrow('Division by zero');
  });

  it('should handle negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5);
  });

  it('should handle decimal results', () => {
    expect(divide(10, 3)).toBeCloseTo(3.333, 2);
  });
});
```

## Integration Testing

Test how components work together:

```typescript
describe('Order Processing Integration', () => {
  let orderService: OrderService;
  let paymentService: PaymentService;
  let inventoryService: InventoryService;

  beforeEach(() => {
    // Use real instances, not mocks
    orderService = new OrderService(paymentService, inventoryService);
  });

  it('should complete order when payment succeeds and inventory available', async () => {
    const order = await orderService.createOrder({
      items: [{ productId: 1, quantity: 2 }],
      paymentMethod: 'credit_card'
    });

    expect(order.status).toBe('completed');
    expect(order.payment.status).toBe('paid');
    expect(inventoryService.getStock(1)).toBe(8); // Was 10, reduced by 2
  });
});
```

## Async Testing

Handle promises and async code properly:

```typescript
// Using async/await (preferred)
it('should fetch data asynchronously', async () => {
  const data = await fetchData();
  expect(data).toBeDefined();
});

// Using done callback (when needed)
it('should handle callback', (done) => {
  fetchDataWithCallback((data) => {
    expect(data).toBeDefined();
    done();
  });
});

// Testing errors
it('should reject with error on failure', async () => {
  await expect(fetchData()).rejects.toThrow('Network error');
});
```

## Test Coverage Goals

**Not all code needs 100% coverage**. Prioritize:
- **Critical business logic**: 90-100%
- **Public APIs**: 80-90%
- **Error handling**: 80-90%
- **Complex algorithms**: 90-100%
- **Simple getters/setters**: Lower priority
- **UI rendering**: E2E tests often better

## Common Pitfalls to Avoid

### 1. Testing Implementation Details
**Bad**: Testing private methods or internal state
**Good**: Testing public behavior and observable outcomes

### 2. Flaky Tests
**Avoid**:
- Timing dependencies (`setTimeout` in tests)
- Random data (use fixed seeds)
- Shared mutable state between tests
- External service dependencies without mocks

### 3. Slow Tests
**Speed up by**:
- Using in-memory databases for integration tests
- Mocking expensive operations
- Running tests in parallel
- Avoiding unnecessary setup

### 4. Brittle Tests
**Make tests resilient by**:
- Testing behavior, not implementation
- Using flexible matchers (`toContain` vs exact equality)
- Avoiding hard-coded values when possible
- Not coupling to internal structure

## Test Organization

```
src/
  services/
    userService.ts
    userService.spec.ts  ← Co-located with source

tests/
  integration/           ← Integration tests separate
    userFlow.spec.ts
  e2e/
    checkout.e2e.ts
```

## Writing Testable Code

### Dependency Injection
```typescript
// Testable: Dependencies injected
class OrderService {
  constructor(
    private paymentService: PaymentService,
    private emailService: EmailService
  ) {}
}

// Not testable: Hard-coded dependencies
class OrderService {
  private paymentService = new PaymentService();
  private emailService = new EmailService();
}
```

### Pure Functions
```typescript
// Testable: Pure function
function calculateDiscount(price: number, discountPercent: number): number {
  return price * (1 - discountPercent / 100);
}

// Harder to test: Side effects
function applyDiscount(order: Order) {
  order.total = order.total * 0.9;
  saveToDatabase(order);
  sendEmail(order.customerEmail);
}
```

## Quick Reference

**Vitest/Jest Matchers**:
- `expect(value).toBe(expected)` - Strict equality
- `expect(value).toEqual(expected)` - Deep equality
- `expect(value).toBeTruthy()` / `.toBeFalsy()`
- `expect(array).toContain(item)`
- `expect(fn).toThrow(error)`
- `expect(value).toBeCloseTo(number, decimals)`

**Mocking**:
- `vi.fn()` - Create mock function
- `vi.spyOn(object, 'method')` - Spy on existing method
- `mockFn.mockReturnValue(value)` - Set return value
- `mockFn.mockResolvedValue(value)` - Set async return
- `expect(mockFn).toHaveBeenCalledWith(args)` - Verify calls

Remember: **Good tests are fast, isolated, deterministic, and focus on behavior over implementation.**
