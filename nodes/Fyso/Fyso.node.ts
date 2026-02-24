import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeListSearchResult,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function fysoLogin(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { success: boolean; data?: { token: string }; error?: string };
  if (!data.success || !data.data?.token) {
    throw new Error(`Fyso login failed: ${data.error ?? 'unknown error'}`);
  }
  return data.data.token;
}

async function fysoSelectTenant(
  baseUrl: string,
  sessionToken: string,
  tenantId: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/tenants/${tenantId}/select`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const data = (await res.json()) as { success: boolean; data?: { token: string }; error?: string };
  if (!data.success || !data.data?.token) {
    throw new Error(`Fyso tenant select failed: ${data.error ?? 'unknown error'}`);
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

// ─── Node ─────────────────────────────────────────────────────────────────────

export class Fyso implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Fyso',
    name: 'fyso',
    icon: 'file:fyso.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + " · " + $parameter["entityName"]}}',
    description: 'Crear, leer, actualizar y eliminar registros en Fyso',
    defaults: { name: 'Fyso' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    credentials: [{ name: 'fysoApi', required: true }],
    properties: [
      // ── Tenant ──────────────────────────────────────────────────────────────
      {
        displayName: 'Tenant',
        name: 'tenantId',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        description: 'El tenant de Fyso sobre el que operar',
        modes: [
          {
            displayName: 'Lista',
            name: 'list',
            type: 'list',
            placeholder: 'Seleccioná un tenant...',
            typeOptions: {
              searchListMethod: 'getTenants',
              searchable: true,
            },
          },
          {
            displayName: 'ID',
            name: 'id',
            type: 'string',
            placeholder: 'uuid del tenant',
            validation: [{ type: 'regex', properties: { regex: '.+', errorMessage: 'Ingresá un ID válido' } }],
          },
        ],
      },
      // ── Operation ───────────────────────────────────────────────────────────
      {
        displayName: 'Operación',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Crear Registro', value: 'create', action: 'Crear un registro' },
          { name: 'Obtener Registro', value: 'get', action: 'Obtener un registro por ID' },
          { name: 'Listar Registros', value: 'list', action: 'Listar registros de una entidad' },
          { name: 'Actualizar Registro', value: 'update', action: 'Actualizar un registro' },
          { name: 'Eliminar Registro', value: 'delete', action: 'Eliminar un registro' },
        ],
        default: 'create',
      },
      // ── Entity ──────────────────────────────────────────────────────────────
      {
        displayName: 'Entidad',
        name: 'entityName',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        description: 'La entidad de Fyso sobre la que operar',
        modes: [
          {
            displayName: 'Lista',
            name: 'list',
            type: 'list',
            placeholder: 'Seleccioná una entidad...',
            typeOptions: {
              searchListMethod: 'getEntities',
              searchable: true,
            },
          },
          {
            displayName: 'Nombre',
            name: 'name',
            type: 'string',
            placeholder: 'pacientes',
          },
        ],
      },
      // ── Record ID (get / update / delete) ────────────────────────────────────
      {
        displayName: 'ID del Registro',
        name: 'recordId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['get', 'update', 'delete'] } },
        description: 'UUID del registro',
      },
      // ── Data (create / update) ───────────────────────────────────────────────
      {
        displayName: 'Datos',
        name: 'data',
        type: 'json',
        default: '{}',
        required: true,
        displayOptions: { show: { operation: ['create', 'update'] } },
        description: 'Campos del registro en formato JSON',
      },
      // ── List options ─────────────────────────────────────────────────────────
      {
        displayName: 'Límite',
        name: 'limit',
        type: 'number',
        default: 100,
        displayOptions: { show: { operation: ['list'] } },
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
        return {
          results: data.data.map((t) => ({ name: `${t.name} (${t.slug})`, value: t.id })),
        };
      },

      async getEntities(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
        const tenantLocator = this.getNodeParameter('tenantId') as { value: string };
        const tenantId = tenantLocator.value;
        if (!tenantId) return { results: [] };
        const { baseUrl, token } = await getAuth(this, tenantId);
        const res = await fetch(`${baseUrl}/api/metadata/entities`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { success: boolean; data?: Array<{ name: string; displayName: string }> };
        if (!data.success || !data.data) return { results: [] };
        return {
          results: data.data.map((e) => ({ name: e.displayName ?? e.name, value: e.name })),
        };
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const tenantLocator = this.getNodeParameter('tenantId', i) as { value: string };
      const entityLocator = this.getNodeParameter('entityName', i) as { value: string };
      const operation = this.getNodeParameter('operation', i) as string;
      const tenantId = tenantLocator.value;
      const entityName = entityLocator.value;

      const { baseUrl, token } = await getAuth(this, tenantId);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const base = `${baseUrl}/api/entities/${entityName}`;

      let responseData: unknown;

      if (operation === 'create') {
        const raw = this.getNodeParameter('data', i) as string;
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const res = await fetch(`${base}/records`, { method: 'POST', headers, body: JSON.stringify(body) });
        responseData = await res.json();
      } else if (operation === 'get') {
        const recordId = this.getNodeParameter('recordId', i) as string;
        const res = await fetch(`${base}/records/${recordId}`, { headers });
        responseData = await res.json();
      } else if (operation === 'list') {
        const limit = this.getNodeParameter('limit', i) as number;
        const res = await fetch(`${base}/records?limit=${limit}`, { headers });
        const data = (await res.json()) as { success: boolean; data?: unknown[] };
        if (data.success && Array.isArray(data.data)) {
          return [data.data.map((record) => ({ json: record as Record<string, unknown> }))];
        }
        responseData = data;
      } else if (operation === 'update') {
        const recordId = this.getNodeParameter('recordId', i) as string;
        const raw = this.getNodeParameter('data', i) as string;
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const res = await fetch(`${base}/records/${recordId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        });
        responseData = await res.json();
      } else if (operation === 'delete') {
        const recordId = this.getNodeParameter('recordId', i) as string;
        const res = await fetch(`${base}/records/${recordId}`, { method: 'DELETE', headers });
        responseData = await res.json();
      } else {
        throw new NodeOperationError(this.getNode(), `Operación desconocida: ${operation}`);
      }

      results.push({ json: responseData as Record<string, unknown> });
    }

    return [results];
  }
}
