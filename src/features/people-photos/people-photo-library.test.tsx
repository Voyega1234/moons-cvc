import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PeoplePhotoLibrary } from "./people-photo-library";
import { listPeoplePhotos, uploadPeoplePhoto, removePeoplePhoto, analyzeStoredPeoplePhoto } from "../../services/people-photos/people-photo-library";

vi.mock("../../services/people-photos/people-photo-library", () => ({ listPeoplePhotos: vi.fn(), uploadPeoplePhoto: vi.fn(), removePeoplePhoto: vi.fn(), analyzeStoredPeoplePhoto: vi.fn() }));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  vi.mocked(listPeoplePhotos).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });

it("uploads and automatically labels photos while showing only images and controls", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  render(<PeoplePhotoLibrary onClose={close} />);
  await screen.findByText(/No people photos yet/);
  const file = new File(["real photo"], "person.png", { type: "image/png" });
  vi.mocked(listPeoplePhotos).mockResolvedValue([{ path: "photo.png", title: "Pexels 123", url: "https://example.com/photo.png", analysis: { description: "Person seated at desk", tags: ["นั่งโต๊ะ"], apparentAgeBand: "25-34" } }]);
  await user.upload(screen.getByLabelText("Upload people photos"), file);
  await screen.findByRole("img", { name: "Person seated at desk" });
  expect(uploadPeoplePhoto).toHaveBeenCalledWith(file, "", { ageBand: "unknown", gender: "unspecified" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByText("Pexels 123")).toBeNull();
  expect(screen.queryByText(/No Analyze step|JPEG, PNG|visual labels/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /retry labeling/i })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledOnce();
});

it("keeps an accessible retry control only for photos missing automatic labels", async () => {
  const photo = { path: "photo.jpg", title: "Portrait", url: "https://example.com/photo.jpg" };
  vi.mocked(listPeoplePhotos).mockResolvedValue([photo]);
  const user = userEvent.setup();
  render(<PeoplePhotoLibrary onClose={vi.fn()} />);
  await screen.findByRole("img", { name: "Portrait" });
  vi.mocked(listPeoplePhotos).mockResolvedValue([{ ...photo, path: "labeled.jpg", analysis: { description: "Person seated", tags: ["seated"], apparentAgeBand: "25-34" } }]);
  await user.click(screen.getByRole("button", { name: "Retry labeling Portrait" }));
  await screen.findByRole("img", { name: "Person seated" });
  expect(analyzeStoredPeoplePhoto).toHaveBeenCalledWith(photo);
  expect(screen.queryByRole("button", { name: /retry labeling/i })).toBeNull();
});

it("removes a photo using its accessible icon after confirmation", async () => {
  vi.mocked(listPeoplePhotos).mockResolvedValue([{ path: "photo.png", title: "Portrait", url: "https://example.com/photo.png" }]);
  const user = userEvent.setup();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<PeoplePhotoLibrary onClose={vi.fn()} />);
  await screen.findByRole("img", { name: "Portrait" });
  await user.click(screen.getByRole("button", { name: "Remove Portrait" }));
  await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  expect(removePeoplePhoto).toHaveBeenCalledWith("photo.png");
});

it("reports unavailable storage instead of suggesting the library is empty", async () => {
  vi.mocked(listPeoplePhotos).mockRejectedValue(new Error("People photo storage is unavailable"));
  render(<PeoplePhotoLibrary onClose={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain("storage is unavailable");
  expect(screen.queryByText(/No people photos yet/)).toBeNull();
});
