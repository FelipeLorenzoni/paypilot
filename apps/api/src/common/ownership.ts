import { NotFoundException } from "@nestjs/common";

/**
 * Reusable per-user ownership check. On mismatch it throws a generic
 * NotFoundException (404-like) so the API never reveals whether another user's
 * record exists (auth-jwt R4). The owner id must always come from the
 * authenticated token, never from client input.
 */
export function assertOwnership(
  resourceOwnerId: string,
  currentUserId: string,
): void {
  if (resourceOwnerId !== currentUserId) {
    throw new NotFoundException();
  }
}
