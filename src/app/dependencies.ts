import type { BrandRepository } from "../ports/brand-repository";
import type { BrandMemoryRepository } from "../ports/brand-memory-repository";
import type { ClientIntakeRepository } from "../ports/client-intake-repository";
import type { MappingClientRepository } from "../ports/mapping-client-repository";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { env } from "../config/env";
import { getSupabaseClient } from "../lib/supabase/client";
import { mockBrandRepository } from "../repositories/brands/mock-brand-repository";
import { MockBrandMemoryRepository } from "../repositories/brand-memory/mock-brand-memory-repository";
import { MockClientIntakeRepository } from "../repositories/client-intake/mock-client-intake-repository";
import { SupabaseClientIntakeRepository } from "../repositories/client-intake/supabase-client-intake-repository";
import { SupabaseBrandMemoryRepository } from "../repositories/brand-memory/supabase-brand-memory-repository";
import { GoogleSheetMappingClientRepository } from "../repositories/mapping-clients/google-sheet-mapping-client-repository";
import { SupabaseBrandRepository } from "../repositories/brands/supabase-brand-repository";
import { LocalWorkspaceRepository } from "../repositories/workspace/local-workspace-repository";
import { LocalFirstWorkspaceRepository } from "../repositories/workspace/local-first-workspace-repository";
import { ScopedLocalWorkspaceRepository } from "../repositories/workspace/scoped-local-workspace-repository";
import { SupabaseWorkspaceRepository } from "../repositories/workspace/supabase-workspace-repository";

const localWorkspaceRepository = new LocalWorkspaceRepository(
  window.localStorage
);
const signedInUserWorkspaceRepository = new ScopedLocalWorkspaceRepository(
  window.localStorage,
  async () => {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) throw error;
    if (!data.session?.user) {
      throw new Error("Sign in before loading the workspace.");
    }
    return data.session.user.id;
  }
);

export interface AppDependencies {
  brandRepository: BrandRepository;
  brandMemoryRepository: BrandMemoryRepository;
  clientIntakeRepository: ClientIntakeRepository;
  mappingClientRepository: MappingClientRepository;
  workspaceRepository: WorkspaceRepository;
}

/**
 * Single composition root for shared infrastructure.
 * Swap a mock implementation for Supabase here without changing feature code.
 */
export const dependencies: AppDependencies = {
  brandRepository:
    env.dataSource === "supabase"
      ? new SupabaseBrandRepository()
      : mockBrandRepository,
  brandMemoryRepository:
    env.dataSource === "supabase"
      ? new SupabaseBrandMemoryRepository()
      : new MockBrandMemoryRepository(),
  clientIntakeRepository:
    env.dataSource === "supabase"
      ? new SupabaseClientIntakeRepository()
      : new MockClientIntakeRepository(mockBrandRepository),
  mappingClientRepository: new GoogleSheetMappingClientRepository(),
  workspaceRepository:
    env.dataSource === "supabase"
      ? new LocalFirstWorkspaceRepository(
          signedInUserWorkspaceRepository,
          new SupabaseWorkspaceRepository()
        )
      : localWorkspaceRepository
};
