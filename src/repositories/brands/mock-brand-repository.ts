import { brands as mockBrands } from "../../data/mock-brands";
import type { Brand } from "../../domain/brand";
import type { BrandRepository } from "../../ports/brand-repository";

export class MockBrandRepository implements BrandRepository {
  private readonly brands: Brand[] = [...mockBrands];

  async list(): Promise<readonly Brand[]> {
    return this.brands;
  }

  async getById(id: string): Promise<Brand | null> {
    return this.brands.find((brand) => brand.id === id) ?? null;
  }

  addClient(brand: Brand): void {
    this.brands.push(brand);
  }

  updateClient(brand: Brand): void {
    const index = this.brands.findIndex((candidate) => candidate.id === brand.id);
    if (index >= 0) this.brands[index] = brand;
  }
}

export const mockBrandRepository = new MockBrandRepository();
