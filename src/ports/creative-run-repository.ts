import type { CreativeRun } from "../domain/creative-run";

export interface CreativeRunRepository {
  list(): Promise<readonly CreativeRun[]>;
  getById(id: string): Promise<CreativeRun | null>;
  save(run: CreativeRun): Promise<void>;
}
