import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateCreditCardData {
  label: string;
  closingDay: number;
  dueDay: number;
  creditLimitMinor: bigint | null;
}

export interface UpdateCreditCardData {
  label?: string;
  closingDay?: number;
  dueDay?: number;
  creditLimitMinor?: bigint | null;
}

export interface ListFilters {
  active?: boolean;
  skip: number;
  take: number;
}

/** Owner-scoped Prisma access for credit cards. */
@Injectable()
export class CreditCardsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, data: CreateCreditCardData) {
    return this.prisma.creditCard.create({ data: { userId, ...data } });
  }

  findOwned(userId: string, id: string) {
    return this.prisma.creditCard.findFirst({ where: { id, userId } });
  }

  async findManyWithCount(userId: string, filters: ListFilters) {
    const where = {
      userId,
      ...(filters.active === undefined ? {} : { isActive: filters.active }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.creditCard.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: filters.skip,
        take: filters.take,
      }),
      this.prisma.creditCard.count({ where }),
    ]);
    return { rows, total };
  }

  updateOwned(userId: string, id: string, data: UpdateCreditCardData) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.creditCard.updateMany({
        where: { id, userId },
        data,
      });
      if (count === 0) {
        return null;
      }
      return tx.creditCard.findFirst({ where: { id, userId } });
    });
  }

  /**
   * Deactivate (soft-stop) a card the user owns. Returns false when no owned
   * card matched (→ 404 at the service). Never hard-deletes, so generated card
   * transactions and purchase plans referencing it are preserved.
   */
  async deactivateOwned(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.creditCard.updateMany({
      where: { id, userId },
      data: { isActive: false },
    });
    return count > 0;
  }
}
