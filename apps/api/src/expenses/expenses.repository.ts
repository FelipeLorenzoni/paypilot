import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateTransactionData {
  type: "EXPENSE";
  source: "MANUAL";
  amountMinor: bigint;
  currency: string;
  transactionDate: Date;
  description: string;
  categoryLabel: string | null;
}

export interface UpdateTransactionData {
  amountMinor?: bigint;
  currency?: string;
  transactionDate?: Date;
  description?: string;
  categoryLabel?: string | null;
}

export interface ListFilters {
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

/** Owner-scoped Prisma access for the transaction ledger (manual expenses). */
@Injectable()
export class ExpensesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, data: CreateTransactionData) {
    return this.prisma.transaction.create({ data: { userId, ...data } });
  }

  findOwned(userId: string, id: string) {
    return this.prisma.transaction.findFirst({ where: { id, userId } });
  }

  async findManyWithCount(userId: string, filters: ListFilters) {
    const where = this.buildWhere(userId, filters.from, filters.to);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
        skip: filters.skip,
        take: filters.take,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { rows, total };
  }

  updateOwned(userId: string, id: string, data: UpdateTransactionData) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transaction.updateMany({
        where: { id, userId },
        data,
      });
      if (count === 0) {
        return null;
      }
      return tx.transaction.findFirst({ where: { id, userId } });
    });
  }

  async deleteOwned(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.transaction.deleteMany({
      where: { id, userId },
    });
    return count > 0;
  }

  private buildWhere(userId: string, from?: Date, to?: Date) {
    if (!from && !to) {
      return { userId };
    }
    return {
      userId,
      transactionDate: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    };
  }
}
