import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createMoney } from "@paypilot/shared";
import type { CreateExpenseDto } from "./dto/create-expense.dto";
import type { ListExpensesQueryDto } from "./dto/list-expenses-query.dto";
import type { UpdateExpenseDto } from "./dto/update-expense.dto";
import {
  type ExpenseResponse,
  toAmountBigInt,
  toAmountNumber,
  toDateOnly,
  toExpenseResponse,
} from "./expense.mapper";
import {
  ExpensesRepository,
  type UpdateTransactionData,
} from "./expenses.repository";

export interface ExpenseList {
  data: ExpenseResponse[];
  meta: { page: number; pageSize: number; total: number };
}

@Injectable()
export class ExpensesService {
  constructor(private readonly repo: ExpensesRepository) {}

  async create(
    userId: string,
    dto: CreateExpenseDto,
  ): Promise<ExpenseResponse> {
    // Single source of money validation (safe-integer + ISO-4217).
    const money = createMoney(dto.amountMinor, dto.currency);
    const row = await this.repo.create(userId, {
      type: "EXPENSE",
      source: "MANUAL",
      amountMinor: toAmountBigInt(money.amountMinor),
      currency: money.currency,
      transactionDate: toDateOnly(dto.expenseDate),
      description: dto.description,
      categoryLabel: dto.category ?? null,
    });
    return toExpenseResponse(row);
  }

  async list(
    userId: string,
    query: ListExpensesQueryDto,
  ): Promise<ExpenseList> {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException("`from` must be on or before `to`");
    }
    const { rows, total } = await this.repo.findManyWithCount(userId, {
      from: query.from ? toDateOnly(query.from) : undefined,
      to: query.to ? toDateOnly(query.to) : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      data: rows.map(toExpenseResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(userId: string, id: string): Promise<ExpenseResponse> {
    const row = await this.repo.findOwned(userId, id);
    if (!row) {
      throw new NotFoundException();
    }
    return toExpenseResponse(row);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    const touchesMoney =
      dto.amountMinor !== undefined || dto.currency !== undefined;
    const hasField =
      touchesMoney ||
      dto.expenseDate !== undefined ||
      dto.description !== undefined ||
      dto.category !== undefined;
    if (!hasField) {
      throw new BadRequestException("At least one field must be provided");
    }

    const existing = await this.repo.findOwned(userId, id);
    if (!existing) {
      throw new NotFoundException();
    }

    const data: UpdateTransactionData = {};
    if (touchesMoney) {
      // Merge the patch with the persisted amount/currency, then re-validate.
      const money = createMoney(
        dto.amountMinor ?? toAmountNumber(existing.amountMinor),
        dto.currency ?? existing.currency,
      );
      data.amountMinor = toAmountBigInt(money.amountMinor);
      data.currency = money.currency;
    }
    if (dto.expenseDate !== undefined) {
      data.transactionDate = toDateOnly(dto.expenseDate);
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.category !== undefined) {
      data.categoryLabel = dto.category ?? null;
    }

    const row = await this.repo.updateOwned(userId, id, data);
    if (!row) {
      throw new NotFoundException();
    }
    return toExpenseResponse(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteOwned(userId, id);
    if (!deleted) {
      throw new NotFoundException();
    }
  }
}
