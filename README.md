# n8n-nodes-fyso

n8n community node for [Fyso](https://fyso.dev) — automate your data platform workflows.

## Features

- **Fyso Node**: Create, read, update, and delete records in any Fyso entity
- **Fyso Trigger**: Fire workflows when records are created, updated, or deleted
- Dynamic dropdowns for tenant and entity selection
- Supports multiple tenants from a single credential

## Installation

In your n8n instance, go to **Settings → Community Nodes** and install:

```
n8n-nodes-fyso
```

## Credentials

Create a **Fyso API** credential with:

| Field    | Description                          |
|----------|--------------------------------------|
| Email    | Your Fyso platform email             |
| Password | Your Fyso platform password          |
| API URL  | `https://api.fyso.dev` (default)     |

## Nodes

### Fyso (Action)

| Operation        | Description                        |
|------------------|------------------------------------|
| Crear Registro   | POST a new record to an entity     |
| Obtener Registro | GET a single record by ID          |
| Listar Registros | GET all records (with limit)       |
| Actualizar Registro | PUT updates to an existing record |
| Eliminar Registro | DELETE a record                   |

**Parameters**: Tenant → Entity → Operation → Data / Record ID

### Fyso Trigger

Fires when a record event occurs in a selected entity:

- `record.created`
- `record.updated`
- `record.deleted`

When activated, the node registers a webhook subscription in Fyso automatically. When deactivated, it deletes the subscription.

**Output payload**:
```json
{
  "event": "record.created",
  "entityName": "pacientes",
  "tenantId": "...",
  "record": { "id": "...", "nombre": "Juan", ... },
  "timestamp": "2026-02-24T..."
}
```

## Development

```bash
npm install
npm run build
npm run dev       # watch mode
```

To test locally, link the package into your n8n custom extensions directory.

## License

MIT
