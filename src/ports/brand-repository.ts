import type { Brand } from "../domain/brand";

export interface BrandRepository {
  list(): Promise<readonly Brand[]>;
  getById(id: string): Promise<Brand | null>;
}
