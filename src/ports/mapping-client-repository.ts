export interface MappingClient {
  clientId: string;
  status: string;
  serviceStatus: string;
}

export interface MappingClientRepository {
  list(): Promise<readonly MappingClient[]>;
}
