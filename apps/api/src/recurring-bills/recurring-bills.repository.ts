import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateRecurringBillData {
  amountMinor: bigint;
  currency: string;
  dayOfMonth: number;
  description: string;
  categoryLabel: string | null;
  startDate: Date;
  endDate: Date | null;
}

export interface UpdateRecurringBillData {
  amountMinor?: bigint;
  currency?: string;
  dayOfMonth?: number;
  description?: string;
  categoryLabel?: string | null;
  startDate?: Date;
  endDate?: Date | null;
}

export interface ListFilters {
  active?: boolean;
  skip: number;
  take: number;
}

/** Owner-scoped Prisma access for recurring bills. */
@Injectable()
export class RecurringBillsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, data: CreateRecurringBillData) {
    return this.prisma.recurringBill.create({ data: { userId, ...data } });
  }

  findOwned(userId: string, id: string) {
    return this.prisma.recurringBill.findFirst({ where: { id, userId } });
  }

  async findManyWithCount(userId: string, filters: ListFilters) {
    const where = {
      userId,
      ...(filters.active === undefined ? {} : { isActive: filters.active }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.recurringBill.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: filters.skip,
        take: filters.take,
      }),
      this.prisma.recurringBill.count({ where }),
    ]);
    return { rows, total };
  }

  updateOwned(userId: string, id: string, data: UpdateRecurringBillData) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.recurringBill.updateMany({
        where: { id, userId },
        data,
      });
      if (count === 0) {
        return null;
      }
      return tx.recurringBill.findFirst({ where: { id, userId } });
    });
  }

  /**
   * Deactivate (soft-stop) a bill the user owns. Returns false when no owned
   * bill matched (→ 404 at the service). Never hard-deletes, so generated
   * transactions referencing the bill are preserved.
   */
  async deactivateOwned(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.recurringBill.updateMany({
      where: { id, userId },
      data: { isActive: false },
    });
    return count > 0;
  }

  /**
   * All active bills across all users, for system generation only. NOT
   * owner-scoped — generation runs for every user's active bills.
   */
  findActiveForGeneration() {
    return this.prisma.recurringBill.findMany({ where: { isActive: true } });
  }
}
