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

### Histórico de efectividad (comparativo, persistente)

El endpoint `/history` guarda **un registro por viaje simulado** con dos comparaciones —
predicción (modelo vs línea recta) y protección (ruta segura vs directa) — y las agrega en
`/history/summary`. La tabla `sim_effectiveness` se **crea sola** en el primer uso.

Para activarlo en el Space, define el secret **`DATABASE_URL`**:

1. HF Space → *Settings → Variables and secrets → New secret*.
2. Nombre `DATABASE_URL`, valor = la *Connection string (URI)* de Supabase (usa el **pooler**
   en el puerto `6543` para conexiones cortas; reemplaza `<password>`).
3. Guardar y reiniciar el Space.

Sin este secret la app funciona igual, pero el histórico cae a almacenamiento del navegador
(no persiste entre dispositivos). Es **replicable a otra ciudad**: cambia la columna `city`.

## 4. (Opcional) Auto-deploy desde GitHub

Para que cada `git push` a GitHub actualice el Space, en los *Settings* del Space puedes
enlazar el repo de GitHub, o añadir un workflow de GitHub Actions que haga `git push` al
remoto `space`. Mientras tanto, el push manual de la sección 2 es suficiente.
