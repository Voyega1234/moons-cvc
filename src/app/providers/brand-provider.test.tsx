import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationMailbox } from "../App";
import { brands } from "../../data/mock-brands";
import type { Brand, ClientIngestionStatus } from "../../domain/brand";
import type { BrandRepository } from "../../ports/brand-repository";
import type { MappingClientRepository } from "../../ports/mapping-client-repository";
import { BrandProvider, useBrands } from "./brand-provider";

afterEach(cleanup);

class MutableBrandRepository implements BrandRepository {
  constructor(private brand: Brand) {}

  async list(): Promise<readonly Brand[]> {
    return [this.brand];
  }

  async getById(id: string): Promise<Brand | null> {
    return this.brand.id === id ? this.brand : null;
  }

  setStatus(status: ClientIngestionStatus, ingestionError?: string) {
    this.brand = { ...this.brand, ingestionStatus: status, ingestionError };
  }
}

const mappingRepository: MappingClientRepository = {
  async list() {
    return [];
  }
};

function NotificationHarness({
  onOpenNotification
}: {
  onOpenNotification: Parameters<typeof NotificationMailbox>[0]["onOpenNotification"];
}) {
  const { refresh } = useBrands();
  return (
    <>
      <button type="button" onClick={() => void refresh()}>
        Refresh brands
      </button>
      <NotificationMailbox onOpenNotification={onOpenNotification} />
    </>
  );
}

describe("brand ingestion notifications", () => {
  it("adds an unread mailbox item when an active ingestion becomes ready", async () => {
    const user = userEvent.setup();
    const fixture = brands[0];
    if (!fixture) throw new Error("Mock brand fixture is missing.");
    const repository = new MutableBrandRepository({
      ...fixture,
      ingestionStatus: "queued"
    });
    const onOpenNotification = vi.fn();

    render(
      <BrandProvider
        repository={repository}
        mappingRepository={mappingRepository}
      >
        <NotificationHarness onOpenNotification={onOpenNotification} />
      </BrandProvider>
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy()
    );

    repository.setStatus("ready");
    await user.click(screen.getByRole("button", { name: "Refresh brands" }));

    const unreadButton = await screen.findByRole("button", {
      name: "Notifications, 1 unread"
    });
    await user.click(unreadButton);

    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText("Brand setup complete")).toBeTruthy();
    expect(
      screen.getByText(`${fixture.name} is ready to use in a creative run.`)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: /Brand setup complete/i })
    );
    expect(onOpenNotification).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: fixture.id, status: "ready" }),
      expect.objectContaining({ id: fixture.id, ingestionStatus: "ready" })
    );
  });

  it("notifies when setup finishes before a queued state is observed", async () => {
    const user = userEvent.setup();
    const fixture = brands[0];
    if (!fixture) throw new Error("Mock brand fixture is missing.");
    const repository = new MutableBrandRepository({
      ...fixture,
      ingestionStatus: "not_started"
    });

    render(
      <BrandProvider
        repository={repository}
        mappingRepository={mappingRepository}
      >
        <NotificationHarness onOpenNotification={vi.fn()} />
      </BrandProvider>
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy()
    );

    repository.setStatus("ready");
    await user.click(screen.getByRole("button", { name: "Refresh brands" }));

    expect(
      await screen.findByRole("button", { name: "Notifications, 1 unread" })
    ).toBeTruthy();
  });

  it("shows the specific ingestion error in a failed mailbox notification", async () => {
    const user = userEvent.setup();
    const fixture = brands[0];
    if (!fixture) throw new Error("Mock brand fixture is missing.");
    const repository = new MutableBrandRepository({
      ...fixture,
      ingestionStatus: "queued"
    });

    render(
      <BrandProvider
        repository={repository}
        mappingRepository={mappingRepository}
      >
        <NotificationHarness onOpenNotification={vi.fn()} />
      </BrandProvider>
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy()
    );

    repository.setStatus("failed", "Please check Facebook page URL.");
    await user.click(screen.getByRole("button", { name: "Refresh brands" }));
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" })
    );

    expect(screen.getByText("Brand setup failed")).toBeTruthy();
    expect(screen.getByText("Please check Facebook page URL.")).toBeTruthy();
  });

  it("adds one mailbox warning when active ingestion has not progressed for 10 minutes", async () => {
    const user = userEvent.setup();
    const fixture = brands[0];
    if (!fixture) throw new Error("Mock brand fixture is missing.");
    const repository = new MutableBrandRepository({
      ...fixture,
      ingestionStatus: "scraping_facebook_posts",
      ingestionUpdatedAt: new Date(Date.now() - 11 * 60 * 1_000).toISOString()
    });

    render(
      <BrandProvider
        repository={repository}
        mappingRepository={mappingRepository}
      >
        <NotificationHarness onOpenNotification={vi.fn()} />
      </BrandProvider>
    );

    const unreadButton = await screen.findByRole("button", {
      name: "Notifications, 1 unread"
    });
    await user.click(unreadButton);

    expect(
      screen.getByText("Brand setup is taking longer than expected")
    ).toBeTruthy();
    expect(
      screen.getByText(
        `${fixture.name} has made no progress for 10 minutes. Open Signal to check its current stage.`
      )
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close notifications" }));
    await user.click(screen.getByRole("button", { name: "Refresh brands" }));
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });
});
