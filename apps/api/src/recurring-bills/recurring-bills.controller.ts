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
import { CreateRecurringBillDto } from "./dto/create-recurring-bill.dto";
import { ListRecurringBillsQueryDto } from "./dto/list-recurring-bills-query.dto";
import { UpdateRecurringBillDto } from "./dto/update-recurring-bill.dto";
import type { RecurringBillResponse } from "./recurring-bill.mapper";
import {
  type RecurringBillList,
  RecurringBillsService,
} from "./recurring-bills.service";

@Controller("recurring-bills")
export class RecurringBillsController {
  constructor(private readonly bills: RecurringBillsService) {}

  @Post()
  create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateRecurringBillDto,
  ): Promise<RecurringBillResponse> {
    return this.bills.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Query() query: ListRecurringBillsQueryDto,
  ): Promise<RecurringBillList> {
    return this.bills.list(user.id, query);
  }

  @Get(":id")
  get(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<RecurringBillResponse> {
    return this.bills.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringBillDto,
  ): Promise<RecurringBillResponse> {
    return this.bills.update(user.id, id, dto);
  }

  /** Deactivates the bill (isActive=false); generated history is preserved. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bills.deactivate(user.id, id);
  }
}
