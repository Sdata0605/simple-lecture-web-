import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  purchasePlus,
  withTimeout,
  AI_TEACHER_ORDER_COURSE_ID,
  type PurchaseDeps,
  type PurchasePlusInput,
} from './aiTeacherPurchase';

const input: PurchasePlusInput = {
  userId: 'user-1',
  name: '  Asha Rao ',
  email: 'asha@example.com',
  phone: '9876543210',
  amountRupees: 500,
};

const okOrder = {
  orderId: 'internal-1',
  razorpayOrderId: 'order_abc',
  razorpayKeyId: 'rzp_live_key',
};

const okCheckout = {
  success: true,
  data: {
    razorpay_payment_id: 'pay_123',
    razorpay_order_id: 'order_abc',
    razorpay_signature: 'sig',
  },
};

function makeDeps(overrides: Partial<PurchaseDeps> = {}): PurchaseDeps {
  return {
    createOrder: vi.fn(async () => okOrder),
    openCheckout: vi.fn(async () => okCheckout),
    verify: vi.fn(async () => ({ verified: true })),
    grant: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'late')).resolves.toBe(42);
  });

  it('rejects with the given message when the promise is too slow', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<number>(() => {}), 500, 'too slow');
    const assertion = expect(pending).rejects.toThrow('too slow');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});

describe('purchasePlus', () => {
  it('grants once and returns success on a verified payment', async () => {
    const deps = makeDeps();
    const result = await purchasePlus(input, deps);

    expect(result).toEqual({ status: 'success' });
    expect(deps.createOrder).toHaveBeenCalledWith(
      'user-1',
      500,
      [{ id: AI_TEACHER_ORDER_COURSE_ID, name: 'AI Teacher Plus', price: 500 }],
      { fullName: 'Asha Rao', email: 'asha@example.com', phone: '9876543210' },
    );
    expect(deps.openCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ razorpayKeyId: 'rzp_live_key', razorpayOrderId: 'order_abc', amountInPaise: 50000 }),
    );
    expect(deps.verify).toHaveBeenCalledWith({
      razorpay_payment_id: 'pay_123',
      razorpay_order_id: 'order_abc',
      razorpay_signature: 'sig',
      orderId: 'internal-1',
      userId: 'user-1',
      courses: [],
    });
    expect(deps.grant).toHaveBeenCalledTimes(1);
    expect(deps.grant).toHaveBeenCalledWith({
      name: 'Asha Rao',
      email: 'asha@example.com',
      phone: '9876543210',
      orderId: 'order_abc',
      paymentId: 'pay_123',
    });
  });

  it('returns an error for a missing user id without touching deps', async () => {
    const deps = makeDeps();
    const result = await purchasePlus({ ...input, userId: '' }, deps);
    expect(result).toEqual({ status: 'error', message: 'Please log in to buy AI Teacher Plus.' });
    expect(deps.createOrder).not.toHaveBeenCalled();
  });

  it('rejects an empty name', async () => {
    const deps = makeDeps();
    const result = await purchasePlus({ ...input, name: '   ' }, deps);
    expect(result).toEqual({ status: 'error', message: 'Please enter your name.' });
    expect(deps.createOrder).not.toHaveBeenCalled();
  });

  it('rejects a phone number that is not 10 digits', async () => {
    const deps = makeDeps();
    const result = await purchasePlus({ ...input, phone: '98765' }, deps);
    expect(result).toEqual({ status: 'error', message: 'Please enter your 10-digit mobile number.' });
    expect(deps.createOrder).not.toHaveBeenCalled();
  });

  it('does not open checkout or grant when the user cancels', async () => {
    const deps = makeDeps({
      openCheckout: vi.fn(async () => ({ success: false, cancelled: true })),
    });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({ status: 'cancelled', message: 'Payment cancelled. You have not been charged.' });
    expect(deps.grant).not.toHaveBeenCalled();
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('returns the Razorpay error with a not-charged note and does not grant', async () => {
    const deps = makeDeps({
      openCheckout: vi.fn(async () => ({ success: false, error: 'Card declined.' })),
    });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({ status: 'error', message: 'Card declined. You have not been charged.' });
    expect(deps.grant).not.toHaveBeenCalled();
  });

  it('returns the order error and does not grant when createOrder fails', async () => {
    const deps = makeDeps({
      createOrder: vi.fn(async () => ({ error: 'server down' })),
    });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({
      status: 'error',
      message: 'We could not start the payment. Please try again in a minute.',
    });
    expect(deps.openCheckout).not.toHaveBeenCalled();
    expect(deps.grant).not.toHaveBeenCalled();
  });

  it('returns the order error when razorpayOrderId is null', async () => {
    const deps = makeDeps({
      createOrder: vi.fn(async () => ({ ...okOrder, razorpayOrderId: null })),
    });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({
      status: 'error',
      message: 'We could not start the payment. Please try again in a minute.',
    });
    expect(deps.openCheckout).not.toHaveBeenCalled();
    expect(deps.grant).not.toHaveBeenCalled();
  });

  it('times out a never-resolving order request and does not grant', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({
      createOrder: vi.fn(() => new Promise<never>(() => {})),
    });
    const pending = purchasePlus(input, deps);
    await vi.advanceTimersByTimeAsync(15000);
    const result = await pending;
    expect(result).toEqual({
      status: 'error',
      message: 'We could not start the payment. Please try again in a minute.',
    });
    expect(deps.openCheckout).not.toHaveBeenCalled();
    expect(deps.grant).not.toHaveBeenCalled();
  });

  it('does not grant when the server reports the payment as unverified', async () => {
    const deps = makeDeps({
      verify: vi.fn(async () => ({ verified: false })),
    });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({
      status: 'error',
      message: 'We could not confirm your payment. If money was deducted, contact support with payment ID pay_123.',
    });
    expect(deps.grant).not.toHaveBeenCalled();
  });

  it('retries verify after a network error and grants once when the retry succeeds', async () => {
    const verify = vi
      .fn<() => Promise<{ verified: boolean; networkError?: boolean }>>()
      .mockResolvedValueOnce({ verified: false, networkError: true })
      .mockResolvedValueOnce({ verified: true });
    const deps = makeDeps({ verify });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({ status: 'success' });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(deps.grant).toHaveBeenCalledTimes(1);
  });

  it('grants when verification never answers (network error twice) because Razorpay reported success', async () => {
    const verify = vi.fn(async () => ({ verified: false, networkError: true }));
    const deps = makeDeps({ verify });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({ status: 'success' });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(deps.grant).toHaveBeenCalledTimes(1);
  });

  it('reports activation failure with the payment id when grant throws', async () => {
    const deps = makeDeps({
      grant: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({
      status: 'error',
      message: 'Payment went through but activation failed. Contact support with payment ID pay_123.',
    });
    expect(deps.grant).toHaveBeenCalledTimes(1);
  });

  it('grants silently for the permanent testing account without creating an order', async () => {
    const deps = makeDeps({ isPermanentTestingAccount: () => true });
    const result = await purchasePlus(input, deps);
    expect(result).toEqual({ status: 'success' });
    expect(deps.createOrder).not.toHaveBeenCalled();
    expect(deps.grant).toHaveBeenCalledTimes(1);
  });
});
