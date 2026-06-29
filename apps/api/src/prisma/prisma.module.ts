import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Global module exposing the {@link PrismaService} to all feature modules. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
