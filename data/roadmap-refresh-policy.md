# Roadmap refresh policy

- Cadence: daily at 03:00 UTC
- Strategy: re-scrape `roadmap.fabric.microsoft.com/fabric-json` for all 13 products, then upsert `dbo.RoadmapItems` (latest-state) and `dbo.RoadmapItemSnapshots` (history).
- Raw source columns are preserved; canonical normalized columns (`normalized_release_type`, `normalized_release_status`, `normalized_release_stage`) are added by the curated view defined in `roadmap-curated.sql`.
- Typo tolerance: `publiew` → `Public Preview`, `GA` / `general availibility` → `General Availability`.

## Fabric automation (created 2026-06-20)

| Artifact | ID |
|---|---|
| Workspace (`FabricRoadmap`) | `bcb36bf0-90ec-4c00-b881-49e06e66fbc7` |
| SQL Database (`FabricRoadmapDb`) | `0ac925df-2016-465d-ae0b-0ecedf77ea44` |
| Notebook (`sync_fabric_roadmap`) | `3577f1c8-dcb9-4ea6-8a15-6a30dc7ebb85` |
| Pipeline (`daily_roadmap_sync`) | `0f98bd33-25ee-4374-af82-586874ea60e5` |

The pipeline contains a single `TridentNotebook` activity (1 retry, 5-min retry interval, 6-hour timeout) that runs `sync_fabric_roadmap`.

### On-demand trigger (PowerShell / curl)

```powershell
$token = az account get-access-token --resource https://api.fabric.microsoft.com --query accessToken -o tsv
$wsId  = "bcb36bf0-90ec-4c00-b881-49e06e66fbc7"
$plId  = "0f98bd33-25ee-4374-af82-586874ea60e5"
Invoke-WebRequest "https://api.fabric.microsoft.com/v1/workspaces/$wsId/items/$plId/jobs/instances?jobType=Pipeline" `
    -Method POST -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body "{}"
```

### ⚠ Remaining manual step: enable the daily schedule in the Fabric portal

The Fabric REST API does not expose a schedule-settings endpoint for Data Pipelines (all variants return 404 as of June 2026).
Set the schedule once in the Fabric portal (< 1 minute):

1. Open <https://app.fabric.microsoft.com>
2. Switch to workspace **FabricRoadmap** (`bcb36bf0-...`)
3. Click the `daily_roadmap_sync` pipeline → **Edit**
4. In the ribbon select **Schedule**
5. Toggle **Scheduled run** → **On**
6. Repeat: **Daily** | Start time **03:00** | Timezone **UTC**
7. Click **Apply**

After that step the pipeline will run automatically every day at 03:00 UTC.
