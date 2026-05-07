type MailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type GraphTokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let graphTokenCache: GraphTokenCache | null = null;

function getAzureMailConfig() {
  const tenantId = String(process.env.AZURE_MAIL_TENANT_ID ?? '').trim();
  const clientId = String(process.env.AZURE_MAIL_CLIENT_ID ?? '').trim();
  const clientSecret = String(process.env.AZURE_MAIL_CLIENT_SECRET ?? '').trim();
  const senderUser = String(process.env.AZURE_MAIL_SENDER_USER ?? '').trim();

  if (!tenantId || !clientId || !clientSecret || !senderUser) {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    senderUser,
  };
}

async function fetchGraphAccessToken(config: NonNullable<ReturnType<typeof getAzureMailConfig>>) {
  const now = Date.now();
  if (graphTokenCache && graphTokenCache.expiresAtMs > now + 15000) {
    return graphTokenCache.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(`Falha ao obter token Azure Graph (${response.status}).`);
  }

  const expiresInSec = Number(payload.expires_in ?? 3600);
  graphTokenCache = {
    accessToken: payload.access_token,
    expiresAtMs: now + Math.max(expiresInSec - 30, 60) * 1000,
  };

  return graphTokenCache.accessToken;
}

async function sendViaAzureGraph(config: NonNullable<ReturnType<typeof getAzureMailConfig>>, payload: MailPayload) {
  const accessToken = await fetchGraphAccessToken(config);
  const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUser)}/sendMail`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: payload.subject,
        body: {
          contentType: payload.html ? 'HTML' : 'Text',
          content: payload.html ?? payload.text,
        },
        toRecipients: [
          {
            emailAddress: {
              address: payload.to,
            },
          },
        ],
      },
      saveToSentItems: false,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Falha ao enviar email via Graph (${response.status}): ${errorBody}`);
  }
}

export async function sendTransactionalEmail(payload: MailPayload) {
  const config = getAzureMailConfig();

  if (!config) {
    console.warn('[EMAIL_DISABLED]', {
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      reason: 'Azure Mail App Registration não configurada.',
    });
    return { delivered: false };
  }

  await sendViaAzureGraph(config, payload);

  return { delivered: true };
}
