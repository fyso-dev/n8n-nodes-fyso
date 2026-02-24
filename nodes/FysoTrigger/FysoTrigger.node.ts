import type {
  IHookFunctions,
  ILoadOptionsFunctions,
  INodeListSearchResult,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

async function fysoLogin(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { success: boolean; data?: { token: string }; error?: string };
  if (!data.success || !data.data?.token) throw new Error(`Fyso login failed: ${data.error}`);
  return data.data.token;
}

async function fysoSelectTenant(baseUrl: string, sessionToken: string, tenantId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/tenants/${tenantId}/select`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const data = (await res.json()) as { success: boolean; data?: { token: string }; error?: string };
  if (!data.success || !data.data?.token) throw new Error(`Fyso tenant select failed: ${data.error}`);
  return data.data.token;
}

async function getAuth(
  ctx: IHookFunctions | IWebhookFunctions | ILoadOptionsFunctions,
  tenantId?: string,
): Promise<{ baseUrl: string; token: string }> {
  const creds = await ctx.getCredentials('fysoApi');
  const baseUrl = (creds.apiUrl as string).replace(/\/$/, '');
  const sessionToken = await fysoLogin(baseUrl, creds.email as string, creds.password as string);
  if (!tenantId) return { baseUrl, token: sessionToken };
  const tenantToken = await fysoSelectTenant(baseUrl, sessionToken, tenantId);
  return { baseUrl, token: tenantToken };
}

export class FysoTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Fyso Trigger',
    name: 'fysoTrigger',
    icon: 'file:fyso.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["eventTypes"].join(", ") + " · " + $parameter["entityName"]}}',
    description: 'Disparar un workflow cuando se crean, actualizan o eliminan registros en Fyso',
    defaults: { name: 'Fyso Trigger' },
    inputs: [],
    outputs: [NodeConnectionType.Main],
    credentials: [{ name: 'fysoApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      // ── Tenant ──────────────────────────────────────────────────────────────
      {
        displayName: 'Tenant',
        name: 'tenantId',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        modes: [
          {
            displayName: 'Lista',
            name: 'list',
            type: 'list',
            placeholder: 'Seleccioná un tenant...',
            typeOptions: { searchListMethod: 'getTenants', searchable: true },
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
      // ── Entity ──────────────────────────────────────────────────────────────
      {
        displayName: 'Entidad',
        name: 'entityName',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        modes: [
          {
            displayName: 'Lista',
            name: 'list',
            type: 'list',
            placeholder: 'Seleccioná una entidad...',
            typeOptions: { searchListMethod: 'getEntities', searchable: true },
          },
          {
            displayName: 'Nombre',
            name: 'name',
            type: 'string',
            placeholder: 'pacientes',
          },
        ],
      },
      // ── Events ──────────────────────────────────────────────────────────────
      {
        displayName: 'Eventos',
        name: 'eventTypes',
        type: 'multiOptions',
        required: true,
        default: ['record.created'],
        options: [
          { name: 'Registro Creado', value: 'record.created' },
          { name: 'Registro Actualizado', value: 'record.updated' },
          { name: 'Registro Eliminado', value: 'record.deleted' },
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
        const tenantId = tenantLocator.value;
        if (!tenantId) return { results: [] };
        const { baseUrl, token } = await getAuth(this, tenantId);
        const res = await fetch(`${baseUrl}/api/metadata/entities`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { success: boolean; data?: Array<{ name: string; displayName: string }> };
        if (!data.success || !data.data) return { results: [] };
        return { results: data.data.map((e) => ({ name: e.displayName ?? e.name, value: e.name })) };
      },
    },
  };

  // Called when the workflow is activated — creates the Fyso webhook subscription
  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const webhookId = this.getWorkflowStaticData('node').webhookId as string | undefined;
        if (!webhookId) return false;
        const tenantLocator = this.getNodeParameter('tenantId') as { value: string };
        const entityLocator = this.getNodeParameter('entityName') as { value: string };
        const { baseUrl, token } = await getAuth(this, tenantLocator.value);
        const res = await fetch(
          `${baseUrl}/api/webhooks/subscriptions?entityName=${entityLocator.value}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = (await res.json()) as { success: boolean; data?: Array<{ id: string }> };
        if (!data.success || !data.data) return false;
        return data.data.some((w) => w.id === webhookId);
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const tenantLocator = this.getNodeParameter('tenantId') as { value: string };
        const entityLocator = this.getNodeParameter('entityName') as { value: string };
        const eventTypes = this.getNodeParameter('eventTypes') as string[];
        const webhookUrl = this.getNodeWebhookUrl('default');

        const { baseUrl, token } = await getAuth(this, tenantLocator.value);
        const res = await fetch(`${baseUrl}/api/webhooks/subscriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityName: entityLocator.value,
            eventTypes,
            url: webhookUrl,
            description: 'n8n workflow trigger',
          }),
        });
        const data = (await res.json()) as { success: boolean; data?: { id: string } };
        if (!data.success || !data.data?.id) return false;
        this.getWorkflowStaticData('node').webhookId = data.data.id;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const webhookId = this.getWorkflowStaticData('node').webhookId as string | undefined;
        if (!webhookId) return true;
        const tenantLocator = this.getNodeParameter('tenantId') as { value: string };
        const { baseUrl, token } = await getAuth(this, tenantLocator.value);
        await fetch(`${baseUrl}/api/webhooks/subscriptions/${webhookId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        delete this.getWorkflowStaticData('node').webhookId;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const body = this.getBodyData();
    return {
      workflowData: [[{ json: body as Record<string, unknown> }]],
    };
  }
}
