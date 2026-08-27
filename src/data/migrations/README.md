# Migrations

Additive, idempotent scripts that are safe to run against a live database. Unlike
`src/data/seed.js` (which **deletes** every chemical / reaction / experiment before reseeding),
nothing here drops or clears data.

## `20260827-first20-elements-and-artwork.js`

Brings the Elements catalogue up to the full first 20 of the periodic table and attaches remote
artwork to each element.

### Prerequisites

1. `.env` has a working `MONGODB_URI` (same one the API uses).
2. For the artwork step only: the shared MinIO from `Deployment-Infrastructure/docker-compose.yaml`
   is running, and `.env` has:
   ```
   MEDIA_PROVIDER=minio
   MINIO_ENDPOINT=localhost:9000
   MINIO_ACCESS_KEY=minioadmin
   MINIO_SECRET_KEY=minioadmin
   MINIO_BUCKET=lab-media
   MINIO_USE_SSL=false
   ```
   The script creates the `lab-media` bucket if it doesn't exist. It stays private — images are
   only ever served through `GET /api/media/chemicals/:id`.
3. `npm install` (adds `minio` + `mime-types`).

### Run

```bash
# 1. See exactly what would change — writes nothing:
node src/data/migrations/20260827-first20-elements-and-artwork.js

# 2. Insert the 14 missing elements (He, Li, Be, B, N, F, Ne, Al, Si, P, S, Ar, K, Ca):
node src/data/migrations/20260827-first20-elements-and-artwork.js --apply

# 3. Also tidy the display names "Hydrogen Gas" -> "Hydrogen" etc. (symbol H2/O2/Cl2 stays):
node src/data/migrations/20260827-first20-elements-and-artwork.js --apply --rename

# 4. Also upload artwork and link it:
node src/data/migrations/20260827-first20-elements-and-artwork.js --apply --rename --images "<path to images folder>"
```

### Artwork step (`--images <dir>`)

Matches **both element and compound** images in the folder to a chemical by name / symbol / formula.
Name the files `<Name>__<Symbol>_....png` — either half is enough to match:

| example filename | matches |
| --- | --- |
| `Sodium__Na_-removebg-preview.png` | element Sodium |
| `Hydrochloric Acid__HCl_.png` | compound HCl |
| `Water__H2O_.png` | compound H2O |
| `Copper(II) Sulfate__CuSO4_.png` | compound CuSO4 |

Objects go to `chemicals/elements/<sym>.png` / `chemicals/compounds/<sym>.png` in the bucket, and
the chemical's `artwork` ref is set. Idempotent — re-run any time you replace an image.

### What it will NOT do

- delete or drop anything
- change any chemical's `symbol` (reactions / practicals / grading key off `symbol`)
- touch reactions, experiments, practicals, sessions, or history
- add Copper / Zinc changes — they stay exactly as they are (Metal Displacement needs them)

### Rollback

Elements it inserted have `createdAt` on/after the run and no `buildReactionId`; artwork can be
cleared with `db.chemicals.updateMany({}, { $set: { artwork: { provider: null } } })`.
