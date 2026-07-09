import { createContext, useContext, type ReactNode } from "react";
import type { BrandMemoryRepository } from "../../ports/brand-memory-repository";

const BrandMemoryContext = createContext<BrandMemoryRepository | null>(null);

export function BrandMemoryProvider({
  repository,
  children
}: {
  repository: BrandMemoryRepository;
  children: ReactNode;
}) {
  return (
    <BrandMemoryContext.Provider value={repository}>
      {children}
    </BrandMemoryContext.Provider>
  );
}

export function useBrandMemoryRepository(): BrandMemoryRepository {
  const repository = useContext(BrandMemoryContext);
  if (!repository) {
    throw new Error(
      "useBrandMemoryRepository must be used inside BrandMemoryProvider."
    );
  }
  return repository;
}
