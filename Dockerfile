# ============================================================
# NómadaAI — Imagen única para Hugging Face Spaces (Docker SDK)
# Sirve la API FastAPI + el frontend web en una sola URL (puerto 7860).
# ============================================================

# --- Etapa 1: build del frontend web ---
FROM node:20-slim AS web
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
# Cadena vacía => el cliente llama a la API en el mismo origen (rutas relativas).
ENV VITE_API_URL=""
# Clave publicable de Clerk (PÚBLICA, se inyecta en el bundle). En HF Spaces se pasa como
# Variable del Space; si está vacía, la app queda en modo invitado (sin login).
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
RUN npm run build:web

# --- Etapa 2: runtime Python (API + estáticos) ---
FROM python:3.11-slim
WORKDIR /app

COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/api/app ./app
# Artefactos de OE1 (parquet + corredores + vecinos) embebidos en la imagen.
COPY services/api/artifacts /research
# Build de la web desde la etapa anterior.
COPY --from=web /repo/apps/web/dist ./static

ENV RESEARCH_DIR=/research
ENV STATIC_DIR=/app/static
ENV PORT=7860
# En HF Spaces el plan free tiene RAM holgada; cargamos todas las trayectorias.
ENV MAX_TRAJECTORIES=0

EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
