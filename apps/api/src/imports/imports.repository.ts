import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Owner-scoped Prisma reads for the import feature. */
@Injectable()
export class ImportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which of the given dedup hashes already exist among the user's IMPORTED
   * rows. Used only for best-effort `duplicateRows` reporting — the partial
   * unique index is the actual guarantee.
   */
  async findExistingHashes(
    userId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.transaction.findMany({
      where: { userId, source: "IMPORTED", dedupHash: { in: hashes } },
      select: { dedupHash: true },
    });
    return new Set(rows.map((r) => r.dedupHash as string));
  }

  findOwnedRun(userId: string, id: string) {
    return this.prisma.importRun.findFirst({ where: { id, userId } });
  }
}
