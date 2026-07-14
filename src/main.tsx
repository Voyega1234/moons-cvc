import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { dependencies } from "./app/dependencies";
import { AuthProvider } from "./app/providers/auth-provider";
import { BrandMemoryProvider } from "./app/providers/brand-memory-provider";
import { BrandProvider } from "./app/providers/brand-provider";
import { ClientIntakeProvider } from "./app/providers/client-intake-provider";
import { WorkspaceProvider } from "./app/providers/workspace-provider";
import "./styles/app.css";
import "./styles/neo-redesign.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Application root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <BrandProvider
        repository={dependencies.brandRepository}
        mappingRepository={dependencies.mappingClientRepository}
      >
        <ClientIntakeProvider repository={dependencies.clientIntakeRepository}>
          <BrandMemoryProvider repository={dependencies.brandMemoryRepository}>
            <WorkspaceProvider repository={dependencies.workspaceRepository}>
              <App />
            </WorkspaceProvider>
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    </AuthProvider>
  </StrictMode>
);
