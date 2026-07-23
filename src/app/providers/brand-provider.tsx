import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  Brand,
  ClientIngestionStatus,
  OnboardingQuestionnaireSource
} from "../../domain/brand";
import {
  allClientAccess,
  filterBrandsForAccess,
  type ClientAccessScope
} from "../../domain/client-access";
import type { BrandRepository } from "../../ports/brand-repository";
import type { MappingClientRepository } from "../../ports/mapping-client-repository";
import { mergeMappingClients } from "../../services/clients/merge-mapping-clients";
import { playMailboxNotificationSound } from "../../shared/utils/notification-sound";

interface BrandContextValue {
  brands: readonly Brand[];
  loading: boolean;
  error: Error | null;
  notifications: readonly BrandNotification[];
  unreadNotificationCount: number;
  refresh: () => Promise<void>;
  readMappingQuestionnaire: (
    sheetUrl: string
  ) => Promise<OnboardingQuestionnaireSource | null>;
  markAllNotificationsRead: () => void;
}

export interface BrandNotification {
  id: string;
  brandId: string;
  brandName: string;
  status:
    | Extract<ClientIngestionStatus, "ready" | "needs_review" | "failed">
    | "stalled";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

type BrandLoadState = Pick<BrandContextValue, "brands" | "loading" | "error">;

export const BRAND_INGESTION_POLL_INTERVAL_MS = 8_000;
export const BRAND_INGESTION_STALL_THRESHOLD_MS = 10 * 60 * 1_000;

const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider({
  repository,
  mappingRepository,
  access = allClientAccess,
  children
}: {
  repository: BrandRepository;
  mappingRepository: MappingClientRepository;
  access?: ClientAccessScope;
  children: ReactNode;
}) {
  const [value, setValue] = useState<BrandLoadState>({
    brands: [],
    loading: true,
    error: null
  });
  const [notifications, setNotifications] = useState<BrandNotification[]>([]);
  const previousStatuses = useRef(new Map<string, ClientIngestionStatus>());
  const notifiedStatuses = useRef(new Map<string, ClientIngestionStatus>());
  const notifiedStalls = useRef(new Map<string, string>());
  const statusesInitialized = useRef(false);

  const loadBrands = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setValue((current) => ({ ...current, loading: true, error: null }));
    }
    return Promise.all([repository.list(), mappingRepository.list()])
      .then(([brands, mappingClients]) => {
        const mergedBrands = filterBrandsForAccess(
          mergeMappingClients(brands, mappingClients),
          access
        );
        const nextStatuses = new Map<string, ClientIngestionStatus>();

        for (const brand of mergedBrands) {
          const status = brand.ingestionStatus;
          if (!status) continue;
          nextStatuses.set(brand.id, status);

          if (isActiveIngestionStatus(status)) {
            notifiedStatuses.current.delete(brand.id);
            if (isBrandIngestionStalled(brand)) {
              const stallKey = `${status}:${brand.ingestionUpdatedAt}`;
              if (notifiedStalls.current.get(brand.id) !== stallKey) {
                notifiedStalls.current.set(brand.id, stallKey);
                const notification = createBrandNotification(brand, "stalled");
                setNotifications((current) =>
                  [notification, ...current].slice(0, 20)
                );
                playMailboxNotificationSound();
              }
            }
          } else {
            notifiedStalls.current.delete(brand.id);
          }

          const previousStatus = previousStatuses.current.get(brand.id);
          if (
            statusesInitialized.current &&
            isNotificationStatus(status) &&
            previousStatus !== status &&
            notifiedStatuses.current.get(brand.id) !== status
          ) {
            const notification = createBrandNotification(brand, status);
            notifiedStatuses.current.set(brand.id, status);
            setNotifications((current) => [notification, ...current].slice(0, 20));
            playMailboxNotificationSound();
          }
        }

        previousStatuses.current = nextStatuses;
        statusesInitialized.current = true;
        setValue({
          brands: mergedBrands,
          loading: false,
          error: null
        });
      })
      .catch((error: unknown) => {
        const nextError =
          error instanceof Error ? error : new Error("Could not load brands.");
        setValue((current) =>
          showLoading
            ? { brands: [], loading: false, error: nextError }
            : { ...current, loading: false, error: nextError }
        );
      });
  }, [access, mappingRepository, repository]);

  const refresh = useCallback(() => loadBrands(true), [loadBrands]);
  const readMappingQuestionnaire = useCallback(
    async (sheetUrl: string) =>
      mappingRepository.readQuestionnaire?.(sheetUrl) ?? null,
    [mappingRepository]
  );

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.read ? notification : { ...notification, read: true }
      )
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActiveIngestion = value.brands.some((brand) =>
    brand.ingestionStatus
      ? isActiveIngestionStatus(brand.ingestionStatus)
      : false
  );

  useEffect(() => {
    if (!hasActiveIngestion) return;
    const interval = window.setInterval(() => {
      void loadBrands(false);
    }, BRAND_INGESTION_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [hasActiveIngestion, loadBrands]);

  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.read
  ).length;

  return (
    <BrandContext.Provider
      value={{
        ...value,
        notifications,
        unreadNotificationCount,
        refresh,
        readMappingQuestionnaire,
        markAllNotificationsRead
      }}
    >
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

function isActiveIngestionStatus(status: ClientIngestionStatus): boolean {
  return !["not_started", "ready", "needs_review", "failed"].includes(status);
}

function isNotificationStatus(
  status: ClientIngestionStatus
): status is Extract<BrandNotification["status"], ClientIngestionStatus> {
  return ["ready", "needs_review", "failed"].includes(status);
}

export function isBrandIngestionStalled(
  brand: Brand,
  now = Date.now()
): boolean {
  if (
    !brand.ingestionStatus ||
    !isActiveIngestionStatus(brand.ingestionStatus) ||
    !brand.ingestionUpdatedAt
  ) {
    return false;
  }

  const updatedAt = Date.parse(brand.ingestionUpdatedAt);
  return (
    Number.isFinite(updatedAt) &&
    now - updatedAt >= BRAND_INGESTION_STALL_THRESHOLD_MS
  );
}

function createBrandNotification(
  brand: Brand,
  status: BrandNotification["status"]
): BrandNotification {
  const content =
    status === "stalled"
      ? {
          title: "Brand setup is taking longer than expected",
          message: `${brand.name} has made no progress for 10 minutes. Open Signal to check its current stage.`
        }
      : status === "ready"
      ? {
          title: "Brand setup complete",
          message: `${brand.name} is ready to use in a creative run.`
        }
      : status === "needs_review"
        ? {
            title: "Brand setup needs review",
            message: `${brand.name} is ready, with Brand Memory items to review.`
          }
        : {
            title: "Brand setup failed",
            message:
              brand.ingestionError?.trim() ||
              `${brand.name} could not finish ingestion. Open Signal to try again.`
          };

  return {
    id: `brand-ingestion-${brand.id}-${Date.now()}`,
    brandId: brand.id,
    brandName: brand.name,
    status,
    ...content,
    createdAt: new Date().toISOString(),
    read: false
  };
}
