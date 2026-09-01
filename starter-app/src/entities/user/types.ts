import type { UserDto, PublicUserDto } from '@shared/api';

// Domain types. Today they equal the DTOs; map them here if the domain shape ever diverges.
export type User = UserDto;
/** What the PUBLIC API exposes — an explicit allowlist, never the full model. */
export type PublicUser = PublicUserDto;
