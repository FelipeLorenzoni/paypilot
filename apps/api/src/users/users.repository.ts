import { Injectable } from "@nestjs/common";
import { normalizeEmail } from "../common/normalize-email";
import { PrismaService } from "../prisma/prisma.service";

/**
 * User data access. All email reads/writes go through the shared
 * {@link normalizeEmail}; `findActiveById` excludes disabled users so the auth
 * guard can reject disabled/deleted accounts.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(email: string, passwordHash: string) {
    return this.prisma.user.create({
      data: { email: normalizeEmail(email), passwordHash },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  findActiveById(id: string) {
    return this.prisma.user.findFirst({ where: { id, isActive: true } });
  }
}
