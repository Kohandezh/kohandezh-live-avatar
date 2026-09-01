// Wire-level DTOs exactly as the contract (docs/api/openapi.yaml) defines them.
// Entities re-export or map these into domain types; shared/ never imports from entities/.
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: string;
}

/** Public tier allowlist — mirrors `PublicUser` in the contract. */
export type PublicUserDto = Pick<UserDto, 'id' | 'displayName'>;
