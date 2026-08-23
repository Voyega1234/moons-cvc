import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { dependencies } from "./app/dependencies";
import { AuthProvider } from "./app/providers/auth-provider";
import { BrandMemoryProvider } from "./app/providers/brand-memory-provider";
import { BrandProvider } from "./app/providers/brand-provider";
import { ClientIntakeProvider } from "./app/providers/client-intake-provider";
import { WorkspaceProvider } from "./app/providers/workspace-provider";
import { RunCollaborationProvider } from "./app/providers/run-collaboration-provider";
import "./styles/app.css";
import "./styles/compass-redesign.css";
import "./styles/workflow/brief-confirmation.css";
import "./styles/workflow/brief-stage.css";
import "./styles/workflow/hook-album-format.css";
import "./styles/workflow/hook-model-comparison.css";
import "./styles/workflow/hook-reference-image.css";
import "./styles/workflow/preflight.css";
import "./styles/workflow/create-build.css";
import "./styles/workflow/ugc-preview.css";
import "./styles/workflow/internal-qc.css";
import "./styles/workflow/client-review.css";
import "./styles/workflow/learn-summary.css";
import "./styles/workflow/my-work.css";
import "./styles/playground.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Application root was not found.");
}

// A new deployment changes chunk filenames; a tab left open from before the
// deploy will fail to fetch the old, now-missing chunk on its next lazy
// import (e.g. clicking "Export slide"). Reload once to pick up the current
// build instead of leaving the user stuck on a broken action.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const reloadedKey = "compass-reloaded-after-preload-error";
  if (sessionStorage.getItem(reloadedKey)) return;
  sessionStorage.setItem(reloadedKey, "1");
  window.location.reload();
});

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <BrandProvider
        repository={dependencies.brandRepository}
        mappingRepository={dependencies.mappingClientRepository}
        access={dependencies.clientAccess}
      >
        <ClientIntakeProvider repository={dependencies.clientIntakeRepository}>
          <BrandMemoryProvider repository={dependencies.brandMemoryRepository}>
            <WorkspaceProvider repository={dependencies.workspaceRepository}>
              <RunCollaborationProvider
                repository={dependencies.runCollaborationRepository}
              >
                <App />
              </RunCollaborationProvider>
            </WorkspaceProvider>
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    </AuthProvider>
  </StrictMode>
);

// This tab is now running the current build; allow a future preload error
// (e.g. after the next deploy) to trigger another reload.
setTimeout(
  () => sessionStorage.removeItem("compass-reloaded-after-preload-error"),
  10_000
);
