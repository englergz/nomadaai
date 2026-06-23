import { NomadaApi } from "@nomadaai/shared";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const api = new NomadaApi(baseUrl);
