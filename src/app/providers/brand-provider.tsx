import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import type { Brand } from "../../domain/brand";
import type { BrandRepository } from "../../ports/brand-repository";
import type { MappingClientRepository } from "../../ports/mapping-client-repository";
import { mergeMappingClients } from "../../services/clients/merge-mapping-clients";

interface BrandContextValue {
  brands: readonly Brand[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

type BrandLoadState = Omit<BrandContextValue, "refresh">;

const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider({
  repository,
  mappingRepository,
  children
}: {
  repository: BrandRepository;
  mappingRepository: MappingClientRepository;
  children: ReactNode;
}) {
  const [value, setValue] = useState<BrandLoadState>({
    brands: [],
    loading: true,
    error: null
  });

  const refresh = useCallback(async () => {
    setValue((current) => ({ ...current, loading: true, error: null }));
    return Promise.all([repository.list(), mappingRepository.list()])
      .then(([brands, mappingClients]) => {
        setValue({
          brands: mergeMappingClients(brands, mappingClients),
          loading: false,
          error: null
        });
      })
      .catch((error: unknown) => {
        setValue({
          brands: [],
          loading: false,
          error:
            error instanceof Error
              ? error
              : new Error("Could not load brands.")
        });
      });
  }, [mappingRepository, repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BrandContext.Provider value={{ ...value, refresh }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrands(): BrandContextValue {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error("useBrands must be used inside BrandProvider.");
  }
  return context;
}
