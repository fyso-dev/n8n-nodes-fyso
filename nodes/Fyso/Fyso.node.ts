import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeListSearchResult,
  INodeType,
  INodeTypeDescription,
  JsonObject,
  ResourceMapperField,
  ResourceMapperFields,
} from 'n8n-workflow';
import { ApplicationError, NodeApiError, NodeOperationError } from 'n8n-workflow';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function fysoLogin(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { success: boolean; data?: { token: string }; error?: string };
  if (!data.success || !data.data?.token) {
    throw new ApplicationError(`Fyso authentication failed: ${data.error ?? 'invalid credentials'}`);
  }
  return data.data.token;
}

async function fysoSelectTenant(baseUrl: string, sessionToken: string, tenantId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/tenants/${tenantId}/select`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const data = (await res.json()) as { success: boolean; data?: { token: string }; error?: string };
  if (!data.success || !data.data?.token) {
    throw new ApplicationError(`Fyso tenant selection failed: ${data.error ?? 'unknown error'}`);
  }
  return data.data.token;
}

async function getAuth(
  ctx: IExecuteFunctions | ILoadOptionsFunctions,
  tenantId?: string,
): Promise<{ baseUrl: string; token: string }> {
  const creds = await ctx.getCredentials('fysoApi');
  const baseUrl = (creds.apiUrl as string).replace(/\/$/, '');
  const sessionToken = await fysoLogin(baseUrl, creds.email as string, creds.password as string);
  if (!tenantId) return { baseUrl, token: sessionToken };
  const tenantToken = await fysoSelectTenant(baseUrl, sessionToken, tenantId);
  return { baseUrl, token: tenantToken };
}

function fysoTypeToN8n(fieldType: string): ResourceMapperField['type'] {
  switch (fieldType) {
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'date': return 'dateTime';
    default: return 'string';
  }
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export class Fyso implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Fyso',
    name: 'fyso',
    icon: 'file:fyso.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + " · " + $parameter["entityName"].value}}',
    description: 'Create, read, update and delete records in Fyso',
    defaults: { name: 'Fyso' },
    usableAsTool: true,
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'fysoApi', required: true }],
    properties: [
      // ── Tenant ──────────────────────────────────────────────────────────────
      {
        displayName: 'Tenant',
        name: 'tenantId',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        description: 'The Fyso tenant that owns the data you want to operate on',
        hint: 'Each tenant is an isolated workspace with its own entities and records',
        modes: [
          {
            displayName: 'List',
            name: 'list',
            type: 'list',
            placeholder: 'Select a tenant...',
            typeOptions: { searchListMethod: 'getTenants', searchable: true },
          },
          {
            displayName: 'ID',
            name: 'id',
            type: 'string',
            placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
            validation: [{ type: 'regex', properties: { regex: '.+', errorMessage: 'Enter a valid tenant ID' } }],
          },
        ],
      },
      // ── Operation ───────────────────────────────────────────────────────────
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Create Record', value: 'create', action: 'Create a record' },
          { name: 'Delete Record', value: 'delete', action: 'Delete a record' },
          { name: 'Get Record', value: 'get', action: 'Get a record by ID' },
          { name: 'List Records', value: 'list', action: 'List records from an entity' },
          { name: 'Update Record', value: 'update', action: 'Update a record' },
        ],
        default: 'create',
      },
      // ── Entity ──────────────────────────────────────────────────────────────
      {
        displayName: 'Entity',
        name: 'entityName',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        description: 'The Fyso entity (data model) to operate on, e.g. patients, orders, products',
        hint: 'Entities are the data models defined in your Fyso tenant',
        modes: [
          {
            displayName: 'List',
            name: 'list',
            type: 'list',
            placeholder: 'Select an entity...',
            typeOptions: { searchListMethod: 'getEntities', searchable: true },
          },
          {
            displayName: 'Name',
            name: 'name',
            type: 'string',
            placeholder: 'e.g. patients',
          },
        ],
      },
      // ── Record ID (get / update / delete) ────────────────────────────────────
      {
        displayName: 'Record ID',
        name: 'recordId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['get', 'update', 'delete'] } },
        description: 'The unique identifier (UUID) of the record to operate on',
        placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
      },
      // ── Fields via resourceMapper (create / update) ───────────────────────────
      {
        displayName: 'Fields',
        name: 'fields',
        type: 'resourceMapper',
        default: { mappingMode: 'defineBelow', value: null },
        noDataExpression: true,
        required: true,
        displayOptions: { show: { operation: ['create', 'update'] } },
        typeOptions: {
          loadOptionsDependsOn: ['tenantId.value', 'entityName.value'],
          resourceMapper: {
            resourceMapperMethod: 'getEntityFields',
            mode: 'upsert',
            fieldWords: { singular: 'Field', plural: 'Fields' },
            addAllFields: true,
            multiKeyMatch: false,
          },
        },
      },
      // ── List options ─────────────────────────────────────────────────────────
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 50,
        description: 'Max number of results to return',
        typeOptions: { minValue: 1 },
        displayOptions: { show: { operation: ['list'] } },
      },
      {
        displayName: 'Offset',
        name: 'offset',
        type: 'number',
        default: 0,
        description: 'Number of records to skip before returning results. Use together with Limit for pagination.',
        typeOptions: { minValue: 0 },
        displayOptions: { show: { operation: ['list'] } },
      },
      // ── Options ──────────────────────────────────────────────────────────────
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add option',
        default: {},
        displayOptions: { show: { operation: ['create', 'get', 'update', 'delete', 'list'] } },
        options: [
          {
            displayName: 'Continue on Fail',
            name: 'continueOnFail',
            type: 'boolean',
            default: false,
            description: 'Whether to continue workflow execution when this node fails. Failed items will include an error property.',
          },
        ],
      },
    ],
  };

  methods = {
    listSearch: {
      async getTenants(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
        const creds = await this.getCredentials('fysoApi');
        const baseUrl = (creds.apiUrl as string).replace(/\/$/, '');
        const token = await fysoLogin(baseUrl, creds.email as string, creds.password as string);
        const res = await fetch(`${baseUrl}/api/auth/tenants`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { success: boolean; data?: Array<{ id: string; name: string; slug: string }> };
        if (!data.success || !data.data) return { results: [] };
        return { results: data.data.map((t) => ({ name: `${t.name} (${t.slug})`, value: t.id })) };
      },

      async getEntities(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
        const tenantLocator = this.getNodeParameter('tenantId') as { value: string };
        if (!tenantLocator.value) return { results: [] };
        const { baseUrl, token } = await getAuth(this, tenantLocator.value);
        const res = await fetch(`${baseUrl}/api/metadata/entities`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { success: boolean; data?: Array<{ name: string; displayName: string }> };
        if (!data.success || !data.data) return { results: [] };
        return { results: data.data.map((e) => ({ name: e.displayName ?? e.name, value: e.name })) };
      },
    },

    resourceMapping: {
      async getEntityFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const tenantLocator = this.getNodeParameter('tenantId') as { value: string };
        const entityLocator = this.getNodeParameter('entityName') as { value: string };
        if (!tenantLocator.value || !entityLocator.value) return { fields: [] };

        const { baseUrl, token } = await getAuth(this, tenantLocator.value);
        const res = await fetch(`${baseUrl}/api/metadata/entities/${entityLocator.value}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as {
          success: boolean;
          data?: {
            fields?: Array<{
              fieldKey: string;
              name: string;
              fieldType: string;
              isRequired?: boolean;
              config?: { options?: Array<{ value: string; label?: string } | string> };
            }>;
          };
        };

        if (!data.success || !data.data?.fields) return { fields: [] };

        const fields: ResourceMapperField[] = data.data.fields.map((f) => {
          const field: ResourceMapperField = {
            id: f.fieldKey,
            displayName: f.name,
            required: f.isRequired ?? false,
            defaultMatch: false,
            display: true,
            type: fysoTypeToN8n(f.fieldType),
            canBeUsedToMatch: false,
          };

          if (f.fieldType === 'select' && f.config?.options) {
            field.options = f.config.options.map((o) =>
              typeof o === 'string' ? { name: o, value: o } : { name: o.label ?? o.value, value: o.value },
            );
          }

          return field;
        });

        return { fields };
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const tenantLocator = this.getNodeParameter('tenantId', i) as { value: string };
        const entityLocator = this.getNodeParameter('entityName', i) as { value: string };
        const operation = this.getNodeParameter('operation', i) as string;
        const tenantId = tenantLocator.value;
        const entityName = entityLocator.value;

        const { baseUrl, token } = await getAuth(this, tenantId);
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const base = `${baseUrl}/api/entities/${entityName}`;

        if (operation === 'create') {
          const fieldData = this.getNodeParameter('fields', i) as { value: IDataObject };
          const body = fieldData.value ?? {};
          const res = await fetch(`${base}/records`, { method: 'POST', headers, body: JSON.stringify(body) });
          const data = (await res.json()) as { success: boolean; data?: IDataObject; error?: string };
          if (!res.ok || !data.success) {
            throw new NodeApiError(this.getNode(), { message: data.error ?? 'Failed to create record', statusCode: res.status } as JsonObject);
          }
          results.push({ json: data.data ?? (data as IDataObject), pairedItem: i });

        } else if (operation === 'get') {
          const recordId = this.getNodeParameter('recordId', i) as string;
          const res = await fetch(`${base}/records/${recordId}`, { headers });
          const data = (await res.json()) as { success: boolean; data?: IDataObject; error?: string };
          if (!res.ok || !data.success) {
            throw new NodeApiError(this.getNode(), { message: data.error ?? `Record ${recordId} not found`, statusCode: res.status } as JsonObject);
          }
          results.push({ json: data.data ?? (data as IDataObject), pairedItem: i });

        } else if (operation === 'list') {
          const limit = this.getNodeParameter('limit', i) as number;
          const offset = this.getNodeParameter('offset', i) as number;
          const res = await fetch(`${base}/records?limit=${limit}&offset=${offset}`, { headers });
          const data = (await res.json()) as { success: boolean; data?: IDataObject[]; error?: string };
          if (!res.ok || !data.success) {
            throw new NodeApiError(this.getNode(), { message: data.error ?? 'Failed to list records', statusCode: res.status } as JsonObject);
          }
          const records = Array.isArray(data.data) ? data.data : [];
          for (const record of records) {
            results.push({ json: record, pairedItem: i });
          }

        } else if (operation === 'update') {
          const recordId = this.getNodeParameter('recordId', i) as string;
          const fieldData = this.getNodeParameter('fields', i) as { value: IDataObject };
          const body = fieldData.value ?? {};
          const res = await fetch(`${base}/records/${recordId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body),
          });
          const data = (await res.json()) as { success: boolean; data?: IDataObject; error?: string };
          if (!res.ok || !data.success) {
            throw new NodeApiError(this.getNode(), { message: data.error ?? `Failed to update record ${recordId}`, statusCode: res.status } as JsonObject);
          }
          results.push({ json: data.data ?? (data as IDataObject), pairedItem: i });

        } else if (operation === 'delete') {
          const recordId = this.getNodeParameter('recordId', i) as string;
          const res = await fetch(`${base}/records/${recordId}`, { method: 'DELETE', headers });
          const data = (await res.json()) as { success: boolean; error?: string };
          if (!res.ok || !data.success) {
            throw new NodeApiError(this.getNode(), { message: data.error ?? `Failed to delete record ${recordId}`, statusCode: res.status } as JsonObject);
          }
          results.push({ json: { success: true, id: recordId }, pairedItem: i });

        } else {
          throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
        }

      } catch (error) {
        if (this.continueOnFail()) {
          results.push({ json: { error: (error as Error).message }, pairedItem: i });
          continue;
        }
        throw error;
      }
    }

    return [results];
  }
}
