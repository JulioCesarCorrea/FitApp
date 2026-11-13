# Despliegue (Railway + APK de Android)

Guía para dejar la API en Railway y la app instalada en un teléfono Android sin depender del PC de desarrollo.
Decisiones y motivos: ADR-0007 y SPEC-deploy-001 (en `.claude/`, que no se publica).

> Nada de lo que sigue se ejecuta solo: hace falta tu cuenta de Railway y la de Expo. **Ningún secreto va al repositorio**
> (esta carpeta es pública): clave de firma, código de invitación y URLs de la base viven solo en las variables de Railway.

## Qué hay aquí

| Archivo | Para qué |
|---|---|
| `Dockerfile` | Imagen de la API (.NET 10) con las imágenes del catálogo dentro. |
| `prepare-upload.ps1` | Prepara `deploy/.stage` (ignorada por git): código de la API + Dockerfile + imágenes. |
| `backup-db.ps1` | Copia de seguridad de la base con `pg_dump` dentro de Docker. |

Las imágenes del catálogo no están en el repositorio (procedencia sin verificar, uso privado); por eso la API no se
despliega desde GitHub sino con `railway up` desde la carpeta preparada.

## Antes de empezar

- Cuenta de [Railway](https://railway.com) (entra con GitHub) y su CLI: `npm i -g @railway/cli`, luego `railway login`.
- Cuenta de [Expo](https://expo.dev) y su CLI: `npm i -g eas-cli`, luego `eas login`.
- Docker Desktop solo si vas a hacer copias de seguridad.
- La carpeta de imágenes del catálogo, indicada en `src/Api/appsettings.Local.json` (`Exercises:ImagesPath`).

## 1. API y base en Railway

1. En Railway crea un proyecto vacío y añade una base: **New → Database → PostgreSQL**.
2. Añade un servicio vacío para la API: **New → Empty Service**, y llámalo `api`.
3. Prepara y sube el código (desde la raíz del repositorio):
   ```powershell
   pwsh deploy/prepare-upload.ps1        # o: powershell -File deploy/prepare-upload.ps1
   cd deploy/.stage
   railway link                          # elige el proyecto (y el entorno production)
   railway up --service api
   ```
4. En el servicio `api`, pestaña **Variables**:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia a la base; la red privada de Railway) |
   | `Auth__JwtKey` | una clave aleatoria de al menos 32 bytes, p. ej. `[Convert]::ToBase64String((1..48 \| % { Get-Random -Max 256 }))` |
   | `Auth__InviteCode` | el código que darás a quien se registre |
   | `Database__MigrateOnStartup` | `true` |
   | `Proxy__TrustForwardedHeaders` | `true` (para que el límite de peticiones vea la IP real) |

   No definas `Auth__DevHeader`: con él activo la API se niega a arrancar fuera de desarrollo.
   Railway fija `PORT` por su cuenta y la API lo usa.
5. En **Settings** del servicio `api`: **Healthcheck Path** = `/health`, y en **Networking** pulsa **Generate Domain** (HTTPS).
6. Despliega de nuevo si hace falta y comprueba `https://<tu-dominio>/health` (responde `{"status":"ok"}`).
7. Crea tu cuenta con el código de invitación, desde la app o con:
   ```powershell
   curl -X POST https://<tu-dominio>/auth/register -H "Content-Type: application/json" `
     -d '{"username":"tu-usuario","password":"una-clave-de-10-o-mas","inviteCode":"<el código>"}'
   ```

**Consumo.** El plan gratuito incluye 1 USD de uso al mes tras los 30 días de prueba (5 USD durante la prueba). Mira el
consumo real en el panel de Railway (Usage) durante la prueba y decide entonces entre el plan gratuito y Hobby (5 USD).

**Cada vez que cambies el código de la API:** vuelve a ejecutar `prepare-upload.ps1` y `railway up --service api`
(el enlace `railway link` se conserva en `deploy/.stage/.railway`).

## 2. APK de Android

Desde `src/mobile`:

```powershell
eas login
eas init                                              # una vez: crea el proyecto en Expo y añade su id a app.json
eas env:set --name EXPO_PUBLIC_API_URL --value https://<tu-dominio> --environment preview --visibility plaintext
eas build --platform android --profile preview        # genera el APK (distribución interna)
```

Si tu versión de `eas-cli` no reconoce `env:set`, usa `eas env:create` con los mismos parámetros.
Al terminar, EAS da un enlace de descarga: ábrelo en el teléfono, descarga el APK e instálalo (permite instalar desde esa
fuente). `EXPO_PUBLIC_*` se incrusta al compilar: si cambia la URL de la API, hay que generar otro APK.

El nombre (`Fitness`) y el paquete (`com.juliocesarcorrea.fitnessapp`) están en `src/mobile/app.json`; cámbialos **antes**
del primer build si no te gustan (el paquete es permanente para quien ya instaló la app).

## 3. Copias de seguridad (P2)

El plan gratuito no garantiza copias. Haz un volcado a mano, a una carpeta tuya fuera de Railway:

```powershell
# En Railway: servicio Postgres → Variables → DATABASE_PUBLIC_URL (es un secreto)
$env:DATABASE_PUBLIC_URL = '<url pública de la base>'
pwsh deploy/backup-db.ps1 -OutDir D:\copias-fitness
```

Genera `fitness-AAAAMMDD-HHmmss.sql.gz`. Para restaurar en una base vacía: `gunzip -c fitness-….sql.gz | psql "<url de destino>"`.
Hazlo con la frecuencia que aceptes perder datos (por ejemplo, semanalmente). No subas los volcados al repositorio
(`*.sql.gz` y `backups/` están ignorados): llevan datos personales.

## 4. Administración en producción

Para crear cuentas o restablecer contraseñas sin pantalla de administración, desde tu PC contra la base de Railway:

```powershell
$env:DATABASE_URL = '<url pública de la base>'
dotnet run --project src/Api -- admin reset-password <usuario>
```

## 5. Lista de comprobación (pruebas manuales)

- [ ] `https://<dominio>/health` responde 200 y una imagen del catálogo se abre en `https://<dominio>/exercise-images/<nombre>-0.jpg` (AC-deploy-001-07).
- [ ] Una petición con solo `X-User-Id` responde 401.
- [ ] El APK se instala, entra con tu cuenta y muestra el catálogo con imágenes (AC-deploy-001-11).
- [ ] Registrar una sesión en modo avión y sincronizar al volver la conexión.
- [ ] `backup-db.ps1` genera un `.sql.gz` y restaura en una base de prueba (AC-deploy-001-09).
- [ ] Anotar el consumo de Railway tras unos días.

## Problemas conocidos

- Cambiar `Auth__JwtKey` cierra todas las sesiones.
- Con `Proxy__TrustForwardedHeaders=true` la API solo debe ser accesible por el dominio de Railway.
- Sin conexión la app sigue funcionando con lo que ya tiene en el teléfono; el asistente de bienvenida y las restricciones piden conexión.
