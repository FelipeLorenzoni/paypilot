import { Module } from "@nestjs/common";
import { ExpensesController } from "./expenses.controller";
import { ExpensesRepository } from "./expenses.repository";
import { ExpensesService } from "./expenses.service";

/** Manual expenses over the generic Transaction ledger. PrismaService is global;
 * routes are protected by the global JwtAuthGuard. */
@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpensesRepository],
})
export class ExpensesModule {}
