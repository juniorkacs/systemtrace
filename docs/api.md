# API reference

Base path: `/api`. All request and response bodies are JSON unless stated. IDs match `^[A-Z][A-Z0-9]{1,9}(-[A-Z0-9]{1,10}){1,3}$` (for example `NAV-001`, `CMP-GNSS`, `TST-PAY-02`).

Errors use one shape:

```json
{ "error": "Validation failed.", "details": [{ "path": "title", "message": "Title needs at least 3 characters" }] }
```

| Status | When |
|---|---|
| 400 | Invalid input, invalid JSON, a missing parent, or a change that would create a hierarchy loop |
| 404 | The requirement, component, test or link doesn't exist |
| 409 | A duplicate ID or link, or deleting something that still has children |
| 413 | Body larger than 2 MB |
| 429 | More than 300 requests a minute from one client |

## Requirements

| Method | Path | Description |
|---|---|---|
| GET | `/requirements?search=&status=&priority=&type=` | List requirements, with `verificationState`, `allocated`, `componentIds`, `testIds` and `childCount` |
| GET | `/requirements/:id` | One requirement, with its links, children and impact analysis |
| POST | `/requirements` | Create. Required: `id`, `title`. Optional: `description`, `type`, `priority`, `status`, `verificationMethod`, `parentId`, `rationale` |
| PATCH | `/requirements/:id` | Partial update. Changing `title` or `description` marks this requirement's links suspect |
| DELETE | `/requirements/:id` | Delete the requirement and its links. Returns 409 if it has children |

## Components and tests

| Method | Path | Description |
|---|---|---|
| GET | `/components` | List components, with `requirementIds` |
| POST, PATCH, DELETE | `/components`, `/components/:id` | Same pattern as requirements. Deleting a component removes its links |
| GET | `/tests` | List tests, with `requirementIds` |
| POST, PATCH, DELETE | `/tests`, `/tests/:id` | Fields: `name`, `method`, `status` (`planned`, `passed`, `failed`, `blocked`), `description`, `lastRun` (YYYY-MM-DD) |

## Links

Body for all three: `{ "requirementId": "NAV-001", "targetType": "component" | "test", "targetId": "CMP-NAV" }`

| Method | Path | Description |
|---|---|---|
| POST | `/links` | Create a link |
| DELETE | `/links` | Remove a link |
| POST | `/links/review` | Clear the suspect flag |

## Analysis

| Method | Path | Description |
|---|---|---|
| GET | `/trace/metrics` | Coverage percentages and counts (see [traceability-rules.md](traceability-rules.md)) |
| GET | `/trace/gaps` | Every gap, high priority first |
| GET | `/trace/matrix?axis=component\|test` | Rows, columns and cells (`none`, `linked`, `suspect`) |
| GET | `/trace/impact/:id` | Ancestors, descendants, components, tests and related requirements |
| GET | `/model` | The full model |
| GET | `/audit?limit=100` | Newest audit entries first (maximum 500) |

## Import and export

| Method | Path | Description |
|---|---|---|
| GET | `/export?format=json` | Full model as a download (`format: "systemtrace/v1"`) |
| GET | `/export?format=csv` | Requirements as CSV, with semicolon-separated `components` and `tests` columns |
| POST | `/import?mode=merge\|replace` | JSON body: the same shape as an export. Runs in a single transaction |
| POST | `/import` with `Content-Type: text/csv` | Merge requirements from CSV. Any invalid row rejects the whole file and returns errors by row number |
| POST | `/demo/reset` | Replace everything with the Kestrel AG-1 demo model |
| GET | `/health` | `{ "status": "ok" }` |
