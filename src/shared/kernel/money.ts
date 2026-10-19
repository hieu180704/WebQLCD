// Số tiền VND, luôn là số nguyên (khớp cột bigint trong DB). Mọi phép tính tiền đi qua class này.
export class Money {
  private constructor(private readonly amount: bigint) {}

  static readonly ZERO = new Money(0n);

  static of(amount: bigint): Money {
    return new Money(amount);
  }

  // Chỉ nhận số nguyên an toàn; số lẻ hoặc vượt Number.MAX_SAFE_INTEGER là lỗi lập trình.
  static fromNumber(amount: number): Money {
    if (!Number.isSafeInteger(amount)) {
      throw new RangeError("Money.fromNumber: cần số nguyên an toàn");
    }
    return new Money(BigInt(amount));
  }

  add(other: Money): Money {
    return new Money(this.amount + other.amount);
  }

  subtract(other: Money): Money {
    return new Money(this.amount - other.amount);
  }

  negate(): Money {
    return new Money(-this.amount);
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.amount === other.amount) return 0;
    return this.amount < other.amount ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.amount === other.amount;
  }

  toBigInt(): bigint {
    return this.amount;
  }

  toString(): string {
    return this.amount.toString();
  }
}
