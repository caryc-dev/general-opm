# Cube plan (Phase 2 container)

Status: signed 2026-10-14. Changes need a new signature. Defines which cube files exist, how they split, and their size budget. The
metrics in them are those of `docs/metric-spec.md`; nothing here changes a definition.

## 1. Entities and file keys
About 800 entities over the whole range: the government (`GOV`), 141 department codes, 4 DOD agencies (`DOD-AF`,
`DOD-AR`, `DOD-DD`, `DOD-NV`) and 653 subelement codes. Every cube file is named by entity key; the browser fetches
only the files the current view needs.

## 2. Cubes
| Cube | Entities | Grains | Contents | One file per | Est. size per file |
|---|---|---|---|---|---|
| core | all (about 800) | month, fiscal quarter, fiscal year | headcount, headcount change, hires and departures by category, DRP, transfers in and out, net flow, rate numerators and denominators for the three methods, years of service lost with coverage, all flags (provisional, partial, reissued, OPM incomplete, known data issues, small base) | entity | 50 to 100 KB |
| compare | each parent: GOV (its departments), each department (its subelements), DOD (its agencies) | fiscal year, trailing 12 months | one row per child per period: headcount, hires, departures, the six reasons and DRP, rate numerators and denominators, flags | parent | under 1 MB (DOD, 169 subelements, is the largest) |
| leaving, joining | GOV, departments, DOD agencies | fiscal year, trailing 12 months, administration, first N months | departures (or hires) and rates by each breakdown of spec section 9, with unknowns and coverage | entity | under 1.5 MB |
| admin | GOV, departments, DOD agencies | months in office | the administration comparison metrics (employee change, running hires and departures, departure rate, why people left) | entity | under 0.5 MB |
| appointments | GOV, departments, DOD agencies | fiscal year, trailing 12 months, administration | hires and departures by appointment group | entity | under 0.5 MB |

Each cube has one `meta.json` (columns with their kind: stock, flow, ratio part or dimension; the manifest hash it
was built from; per-file SHA-256; known breaks and known data issues in scope; provisional and reissued months).
Subelements get core and compare only: breakdowns, administration and appointments stay at government and
department level (spec section 9), so small units are never split into small cells.

## 3. Size budget
- Per file: 3 MB on disk (the DOJ cap). A file that would exceed it fails the gate; the fix is a further split, by
  decision, never a dropped column.
- First load: the government overview fetches at most 3 MB before compression (GOV core, GOV compare, GOV leaving).
- Whole site, cubes plus Look-Up (about 0.4 GB, D-008): under 1 GB, GitHub Pages' published-site limit.
- A full rebuild rewrites every changed file; files whose content did not change keep their bytes and hash, so a
  monthly refresh does not churn the repo.

## 4. Build order
1. core and compare, with the gate checks they need: output_manifest_hash, stock_flow_rollups, coverage_columns,
   reconciliation_fy, provisional_and_revisions, small_base_flags, and a cube size check.
2. The known-breaks list that reconciliation_fy produces, for signature (rule D-009: gap over 5% and over 20 people,
   government and department level).
3. leaving and joining, then admin and appointments.
Cubes are staged under `warehouse/cubes/`; promotion into `web/data/` waits for the verifier and a signed promotion.

## Amendment 1 (signed 2026-10-15): matrix cube
| Cube | Entities | Grains | Contents | One file per | Size |
|---|---|---|---|---|---|
| matrix | departments and the 4 Defense agencies (145) | months in office, each administration | per entity, administration and month: headcount at month 0, headcount change, departures, DRP departures, hire and attrition rate numerators, rate denominator, small-base, provisional and OPM-incomplete flags, known data issues | one file for all entities | 1.54 MB measured on a prototype (0.34 MB compressed) |
Every value is copied from the admin cube of the same entity, administration and month, so the gate can check the
two match exactly. Entities without a comparison for an administration (D-020) have no rows for it. The home page
loads it with GOV admin (40 KB), inside the 3 MB first-load budget.

## Amendment 2 (signed 2026-10-16, D-040): occupation cubes
As written in `docs/occupation-spec.md` section 8 (occupations, occ_family_monthly, occ_series_monthly; about 99 MB;
gate checks occupations_partition, occ_monthly_matches_core, occ_family_from_rows). Subelements get the occupation
cubes (D-037), an exception to section 2's "core and compare only", signed with metric spec amendment M-1 (section 9).
