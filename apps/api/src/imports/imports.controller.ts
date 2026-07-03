import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import { MAX_FILE_BYTES } from "./import.constants";
import {
  type ImportRunView,
  type ImportSummary,
  ImportsService,
} from "./imports.service";

/** Minimal multer file shape we consume (memory storage). */
interface UploadedCsvFile {
  buffer?: Buffer;
}

@Controller("imports")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /**
   * Multipart upload (field name `file`). Memory storage (multer default — no
   * disk writes); `limits.fileSize` rejects oversized uploads at the transport
   * with 413 before the service runs (the service re-checks for direct calls).
   */
  @Post()
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES } }),
  )
  import(
    @CurrentUser() user: SafeUser,
    @UploadedFile() file?: UploadedCsvFile,
  ): Promise<ImportSummary> {
    if (!file?.buffer) {
      throw new BadRequestException("a CSV file is required (field: file)");
    }
    return this.imports.import(user.id, file.buffer);
  }

  @Get(":id")
  getRun(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ImportRunView> {
    return this.imports.getRun(user.id, id);
  }
}
