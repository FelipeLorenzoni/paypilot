import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail()
  email!: string;

  // Min 12, max 256 (rejected, not truncated); spaces/printable allowed; no composition rules.
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;
}
