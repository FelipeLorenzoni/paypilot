import { Controller, Get, Query } from "@nestjs/common";
import type { MonthlySummaryView } from "@paypilot/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import { DashboardService } from "./dashboard.service";
import { MonthlySummaryQueryDto } from "./dto/monthly-summary-query.dto";

/**
 * Monthly summary endpoint. Protected by the global JwtAuthGuard (401) and
 * owner-scoped by `@CurrentUser`. A month with no data is a zeroed summary,
 * never a 404; a malformed `month` is a 400 from the global ValidationPipe.
 */
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  getSummary(
    @CurrentUser() user: SafeUser,
    @Query() query: MonthlySummaryQueryDto,
  ): Promise<MonthlySummaryView> {
    return this.dashboard.getSummary(user.id, query.month);
  }
}
