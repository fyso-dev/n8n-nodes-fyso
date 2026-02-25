import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class FysoApi implements ICredentialType {
  name = 'fysoApi';
  displayName = 'Fyso API';
  icon = 'file:fyso.svg' as const;
  documentationUrl = 'https://docs.fyso.dev';
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.apiUrl}}',
      url: '/api/auth/login',
      method: 'POST',
      body: {
        email: '={{$credentials.email}}',
        password: '={{$credentials.password}}',
      },
    },
  };
  properties: INodeProperties[] = [
    {
      displayName: 'Email',
      name: 'email',
      type: 'string',
      placeholder: 'admin@example.com',
      default: '',
      required: true,
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
    },
    {
      displayName: 'API URL',
      name: 'apiUrl',
      type: 'string',
      default: 'https://api.fyso.dev',
      required: true,
    },
  ];
}
