# Identity Migration Dry-Run Tool

**Purpose:** Pre-migration analysis for Forum identity unification (Phase U1).

Runs a read-only scan of Forum and ADC databases, produces a deterministic identity
mapping report, and evaluates whether it is safe to switch `FORUM_IDENTITY_MODE`
from `legacy-sub` to `business-agent-id`.

## Usage

```bash
FORUM_DATABASE_URL=postgresql://forum:forum_pass@localhost:5434/svc_forum \
ADC_DATABASE_URL=postgresql://postgres:pass@localhost:5432/adc_db \
  npx tsx tools/identity-migration/index.ts
```

## Who

Maintainers preparing the ADC–Forum auth unification migration.
Not needed for day-to-day Forum operation.

## Safety

- **Read-only:** never writes to any database
- **Deterministic:** no guessing or fuzzy matching
- **Report:** written to `.local-reports/identity-dry-run-{timestamp}.json`
