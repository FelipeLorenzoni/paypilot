import { Module } from "@nestjs/common";
import { ImportLedgerWriter } from "./import-ledger-writer";
import { ImportsController } from "./imports.controller";
import { ImportsRepository } from "./imports.repository";
import { ImportsService } from "./imports.service";

/**
 * CSV statement import into the shared Transaction ledger (source = IMPORTED,
 * expenses only) with DB-level dedup (partial unique on (userId, dedupHash))
 * and ImportRun provenance. PrismaService is global; routes are protected by
 * the global JwtAuthGuard. No endpoints edit/delete imported transactions.
 */
@Module({
  controllers: [ImportsController],
  providers: [ImportsService, ImportsRepository, ImportLedgerWriter],
})
export class ImportsModule {}
