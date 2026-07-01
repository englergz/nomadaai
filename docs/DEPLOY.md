# Despliegue en la nube

Arquitectura de despliegue:

- **Hugging Face Spaces (Docker)** — una sola URL pública sirve la **API + la web**.
  Los artefactos de OE1 (parquet + corredores) van embebidos en la imagen. No necesita DB.
- **GitHub** — control de versiones (y opcionalmente origen de sincronización).
- **Supabase (Postgres + PostGIS)** — ya provisionada para OE2/OE3 (aún no la usa OE1).

---

## 1. Subir el código a GitHub

Ya hay un repositorio git inicializado en `appNomadaAI/app` con un commit inicial.

```bash
cd appNomadaAI/app
# Crea el repo en https://github.com/new  (ej. nombre: nomadaai)  y luego:
git remote add origin https://github.com/<tu-usuario>/nomadaai.git
git branch -M main
git push -u origin main
```

> Los archivos grandes embebidos suman ~21 MB (`services/api/artifacts/`), muy por debajo
> del límite de 100 MB de GitHub: no hace falta Git LFS.

## 2. Crear el Space en Hugging Face

1. Entra a https://huggingface.co/new-space
2. Owner: tu usuario · Space name: `nomadaai` · **SDK: Docker** · Hardware: **CPU basic (free)** · Public.
3. Crear. Te dará una URL de repo git, por ejemplo:
   `https://huggingface.co/spaces/<tu-usuario>/nomadaai`

### Publicar (push directo al Space)

```bash
cd appNomadaAI/app
git remote add space https://huggingface.co/spaces/<tu-usuario>/nomadaai
git push space main
```

Hugging Face detectará el `Dockerfile` (gracias a la cabecera `sdk: docker` y
`app_port: 7860` del `README.md`), construirá la imagen y publicará la app en:
`https://<tu-usuario>-nomadaai.hf.space`

> **Autenticación HF:** al hacer `git push space main` te pedirá usuario y un *access token*
> (créalo en https://huggingface.co/settings/tokens con permiso *write*). Úsalo como contraseña.

### Verificar
- Abre la URL del Space → debe cargar el mapa de Tumaco con los corredores.
- `https://<tu-usuario>-nomadaai.hf.space/health` → JSON con `predictor_ready: true`.
- `https://<tu-usuario>-nomadaai.hf.space/docs` → documentación OpenAPI.

## 3. Base de datos Supabase (para OE2/OE3)

Proyecto ya creado: **NomadaAI** · ref `xieogeherhcutydipqpe` · región us-east-1 · PostGIS 3.3.
Esquema aplicado (tablas `corridors`, `trajectories_sample`, `road_nodes`, `road_edges`,
`risk_zones`, `incidents`).

- Dashboard: https://supabase.com/dashboard/project/xieogeherhcutydipqpe
- Cadena de conexión: Dashboard → *Project Settings → Database → Connection string* (URI).

### Cargar los corredores completos (47.788)

```bash
pip install "psycopg[binary]"
export DATABASE_URL="postgresql://postgres:<password>@db.xieogeherhcutydipqpe.supabase.co:5432/postgres"
python appNomadaAI/app/db/etl/load_corridors.py
```

> OE1 (lo que está en producción) **no** usa la base de datos: el backend lee los artefactos
> embebidos. Supabase se activa al construir OE2 (riesgo) y OE3 (ruteo).

### Histórico de efectividad por usuario (comparativo, persistente · BI)

El endpoint `/history` guarda **un registro por viaje simulado**, atado a un `user_id`, con dos
comparaciones — predicción (modelo vs línea recta) y protección (ruta segura vs directa). Agrega
por usuario o global en `/history/summary` y expone un panel BI en `/history/stats` (totales,
por hora, por vehículo, por día). La tabla `sim_effectiveness` se **crea sola** en el primer uso.

**Base de datos: Neon (Postgres gratuito).** Se eligió Neon porque **se reactiva solo** al
conectarse (Supabase free se pausa a los 7 días de inactividad). Como el backend es Postgres puro
(`psycopg` + `DATABASE_URL`), sirve cualquier Postgres sin cambiar código. Neon expone solo la
cadena de conexión privada (no hay API pública anónima), así que la alerta de "tabla pública / RLS"
de Supabase **no aplica**.

El esquema ya está aplicado (ver `db/migrations/002_sim_effectiveness.sql`). Para activar la
persistencia en el Space define el secret **`DATABASE_URL`**:

1. HF Space `englergz/nomadaai` → *Settings → Variables and secrets → New secret*.
2. Nombre `DATABASE_URL`, valor = la cadena de conexión de Neon (Dashboard → *Connection string*).
3. Guardar y reiniciar el Space.

> ⚠️ La `DATABASE_URL` lleva contraseña: **solo** va como secret del Space, nunca en el repo.

Sin este secret la app funciona igual, pero el histórico cae al navegador (no persiste entre
dispositivos). Es **replicable a otra ciudad**: cambia la columna `city`.

### Login opcional (Clerk)

El inicio de sesión es **opcional**: sin configurar nada, la app funciona en **modo invitado**
(identidad anónima por dispositivo). Al iniciar sesión, el histórico pasa a la **cuenta** del
usuario (identidad verificada) y lo sigue entre dispositivos. Los datos siguen en Neon; Clerk solo
gestiona identidades.

1. Crea una aplicación en [clerk.com](https://clerk.com) (gratis). Habilita **Google** y **correo**.
2. **Frontend (clave pública):** en el HF Space → *Settings → Variables* (variable normal, **no**
   secret, la clave es pública), añade `VITE_CLERK_PUBLISHABLE_KEY` = `pk_...`. El Dockerfile la
   inyecta en el build.
3. **Backend (verificación):** añade la variable `CLERK_ISSUER` = el *Issuer / Frontend API* de tu
   instancia Clerk (p. ej. `https://<slug>.clerk.accounts.dev`). El backend verifica los tokens
   contra `${CLERK_ISSUER}/.well-known/jwks.json`.
4. Reinicia el Space.

En POST/DELETE la identidad la impone el **token verificado** (no el cliente), así nadie puede
escribir el histórico de otro. Las lecturas usan ese id cuando hay sesión.

## 4. (Opcional) Auto-deploy desde GitHub

Para que cada `git push` a GitHub actualice el Space, en los *Settings* del Space puedes
enlazar el repo de GitHub, o añadir un workflow de GitHub Actions que haga `git push` al
remoto `space`. Mientras tanto, el push manual de la sección 2 es suficiente.
