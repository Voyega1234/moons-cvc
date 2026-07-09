import { createContext, useContext, type ReactNode } from "react";
import type { ClientIntakeRepository } from "../../ports/client-intake-repository";

const ClientIntakeContext = createContext<ClientIntakeRepository | null>(null);

export function ClientIntakeProvider({
  repository,
  children
}: {
  repository: ClientIntakeRepository;
  children: ReactNode;
}) {
  return (
    <ClientIntakeContext.Provider value={repository}>
      {children}
    </ClientIntakeContext.Provider>
  );
}

export function useClientIntakeRepository(): ClientIntakeRepository {
  const repository = useContext(ClientIntakeContext);
  if (!repository) {
    throw new Error(
      "useClientIntakeRepository must be used inside ClientIntakeProvider."
    );
  }

  return repository;
}
