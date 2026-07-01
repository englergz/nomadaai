import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";

// Login opcional: si hay clave publicable de Clerk, se habilita el inicio de sesión.
// Sin ella, la app funciona en modo invitado (anónimo) sin ningún cambio.
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const tree = clerkKey ? (
  <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/">
    <App />
  </ClerkProvider>
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{tree}</React.StrictMode>
);
