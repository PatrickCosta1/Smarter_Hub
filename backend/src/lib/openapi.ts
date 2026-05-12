export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Smarter Hub API',
    version: '1.0.0',
    description: 'Documentação inicial da API do Smarter Hub.',
  },
  servers: [
    {
      url: '/',
      description: 'Servidor atual',
    },
  ],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check da API',
        responses: {
          '200': {
            description: 'API operacional',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      example: 'ok',
                    },
                  },
                  required: ['status'],
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Autenticação local por utilizador e palavra-passe',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                },
                required: ['username', 'password'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Autenticado com sucesso' },
          '401': { description: 'Credenciais inválidas' },
          '410': { description: 'Login local desativado' },
          '429': { description: 'Rate limit excedido' },
        },
      },
    },
    '/api/auth/microsoft': {
      post: {
        tags: ['Auth'],
        summary: 'Autenticação via Microsoft/Firebase token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  idToken: { type: 'string' },
                },
                required: ['idToken'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Autenticado com sucesso' },
          '401': { description: 'Token inválido' },
          '403': { description: 'Conta não autorizada' },
          '429': { description: 'Rate limit excedido' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Dados do utilizador autenticado',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Dados devolvidos' },
          '401': { description: 'Não autenticado' },
        },
      },
    },
  },
} as const;
