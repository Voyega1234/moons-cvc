import type { WorkspaceState } from "../../features/workflow/model";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import {
  DEFAULT_WORKSPACE_STORAGE_KEY,
  LocalWorkspaceRepository,
  type StorageLike
} from "./local-workspace-repository";

/** Keeps local workspace data separated when multiple users share a browser. */
export class ScopedLocalWorkspaceRepository implements WorkspaceRepository {
  private activeRepository: LocalWorkspaceRepository | null = null;

  constructor(
    private readonly storage: StorageLike,
    private readonly getScope: () => Promise<string>,
    private readonly storageKey = DEFAULT_WORKSPACE_STORAGE_KEY,
    private readonly getNow = () => new Date().toISOString()
  ) {}

  async load(): Promise<WorkspaceState | null> {
    const repository = await this.resolveRepository();
    this.activeRepository = repository;
    return repository.load();
  }

  async save(workspace: WorkspaceState): Promise<void> {
    if (this.activeRepository) {
      return this.activeRepository.save(workspace);
    }

    const repository = await this.resolveRepository();
    this.activeRepository = repository;
    return repository.save(workspace);
  }

  async clear(): Promise<void> {
    if (this.activeRepository) {
      return this.activeRepository.clear();
    }

    const repository = await this.resolveRepository();
    this.activeRepository = repository;
    return repository.clear();
  }

  private async resolveRepository(): Promise<LocalWorkspaceRepository> {
    const scope = await this.getScope();
    if (!scope.trim()) throw new Error("Workspace storage scope is missing.");
    return new LocalWorkspaceRepository(
      this.storage,
      `${this.storageKey}.${scope}`,
      this.getNow
    );
  }
}
