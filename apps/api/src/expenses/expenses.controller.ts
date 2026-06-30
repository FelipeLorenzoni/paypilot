import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ListExpensesQueryDto } from "./dto/list-expenses-query.dto";
import { UpdateExpenseDto } from "./dto/update-expense.dto";
import type { ExpenseResponse } from "./expense.mapper";
import { type ExpenseList, ExpensesService } from "./expenses.service";

@Controller("expenses")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Query() query: ListExpensesQueryDto,
  ): Promise<ExpenseList> {
    return this.expenses.list(user.id, query);
  }

  @Get(":id")
  get(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ExpenseResponse> {
    return this.expenses.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.update(user.id, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.expenses.remove(user.id, id);
  }
}
