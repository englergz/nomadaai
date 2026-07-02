import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { esES } from "@clerk/localizations";
import App from "./App";
import "./index.css";

// Login opcional: si hay clave publicable de Clerk, se habilita el inicio de sesión.
// Sin ella (o si Clerk falla), la app funciona en modo invitado (anónimo).
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

// Red de seguridad: si el árbol falla (p. ej. Clerk no inicializa), en vez de dejar la
// pantalla en blanco reintenta SIN Clerk (modo invitado); si aún falla, muestra el error.
class SafeBoot extends React.Component<
  { children: React.ReactNode },
  { stage: "clerk" | "guest" | "dead"; msg: string }
> {
  state: { stage: "clerk" | "guest" | "dead"; msg: string } = { stage: "clerk", msg: "" };
  static getDerivedStateFromError() {
    return null; // manejamos en componentDidCatch para poder degradar por etapas
  }
  componentDidCatch(error: Error) {
    console.error("Nómada.AI arranque falló:", error);
    this.setState((s) =>
      s.stage === "clerk"
        ? { stage: "guest" as const, msg: String(error?.message || error) }
        : { stage: "dead" as const, msg: String(error?.message || error) },
    );
  }
  render() {
    if (this.state.stage === "dead") {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui", color: "#e6edf3", background: "#0f1419", minHeight: "100vh" }}>
          <h2>No se pudo cargar la app</h2>
          <p style={{ color: "#8b98a5" }}>{this.state.msg}</p>
          <button onClick={() => location.reload()} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #2d3640", background: "#1a2129", color: "#e6edf3", cursor: "pointer" }}>Reintentar</button>
        </div>
      );
    }
    // etapa "clerk": con login; etapa "guest": sin Clerk (invitado)
    if (this.state.stage === "guest" || !clerkKey) {
      (window as unknown as { __CLERK_OFF__?: boolean }).__CLERK_OFF__ = true; // que App no monte AuthBar
      return <App />;
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SafeBoot>
      {clerkKey ? (
        <ClerkProvider publishableKey={clerkKey} localization={esES} afterSignOutUrl="/">
          <App />
        </ClerkProvider>
      ) : (
        <App />
      )}
    </SafeBoot>
  </React.StrictMode>,
);
