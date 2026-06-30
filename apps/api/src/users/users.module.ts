import { Module } from "@nestjs/common";
import { UsersRepository } from "./users.repository";

/** Provides {@link UsersRepository} (PrismaService is global). */
@Module({
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
