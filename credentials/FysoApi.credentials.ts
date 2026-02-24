import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class FysoApi implements ICredentialType {
  name = 'fysoApi';
  displayName = 'Fyso API';
  documentationUrl = 'https://docs.fyso.dev';
  properties: INodeProperties[] = [
    {
      displayName: 'Email',
      name: 'email',
      type: 'string',
      placeholder: 'admin@ejemplo.com',
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
