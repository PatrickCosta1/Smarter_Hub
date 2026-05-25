import { sendTransactionalEmail } from '../../lib/email.js';

export async function sendAdmissionInviteEmail(params: {
  personalEmail: string;
  fullName: string;
  invitationLink: string;
  reviewReason?: string;
}) {
  const isCorrection = Boolean(params.reviewReason);
  const subject = isCorrection
    ? 'Tlantic · atualização necessária no formulário de admissão'
    : 'Bem-vindo à Tlantic · completa o teu formulário de admissão';

  const headerColor = isCorrection ? '#b45309' : '#1a56db';
  const headerGradient = isCorrection
    ? 'linear-gradient(135deg,#b45309,#92400e)'
    : 'linear-gradient(135deg,#1a56db,#0e3f9e)';
  const badgeLabel = isCorrection ? 'Correção solicitada' : 'Convite de admissão';
  const bodyTitle = isCorrection ? 'Atualização necessária no teu formulário' : 'Bem-vindo(a) à Tlantic';
  const bodyText = isCorrection
    ? 'O teu processo de admissão foi devolvido para correção. Revê os dados submetidos e atualiza o formulário de acordo com as observações da equipa de RH.'
    : 'O teu processo de admissão na Tlantic foi iniciado. Usa o link abaixo para preencher o formulário com os teus dados pessoais e profissionais.';

  const reviewBlock = isCorrection && params.reviewReason
    ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:16px 20px;margin:0 0 28px;">
        <p style="margin:0 0 4px;font-weight:700;color:#92400e;font-size:14px;">Motivo da devolução:</p>
        <p style="margin:0;color:#78350f;font-size:14px;line-height:1.6;">${params.reviewReason}</p>
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:48px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

        <!-- HEADER -->
        <tr><td style="background:${headerGradient};padding:40px 40px 32px;text-align:center;">
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:8px;padding:6px 16px;margin-bottom:16px;">
            <span style="color:rgba(255,255,255,0.9);font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">${badgeLabel}</span>
          </div>
          <h1 style="margin:0 0 6px;color:#ffffff;font-size:32px;font-weight:800;letter-spacing:-1px;">Tlantic</h1>
          <p style="margin:0;color:rgba(255,255,255,0.75);font-size:14px;">Smarter Hub · Portal de Recursos Humanos</p>
        </td></tr>

        <!-- BODY -->
        <tr><td style="padding:40px 40px 32px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:22px;font-weight:700;">${bodyTitle}</h2>
          <p style="margin:0 0 8px;color:#6b7280;font-size:15px;">Olá <strong style="color:#111827;">${params.fullName}</strong>,</p>
          <p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.7;">${bodyText}</p>

          ${reviewBlock}

          <!-- CTA BUTTON -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 32px;">
            <tr>
              <td align="center">
                <a href="${params.invitationLink}" target="_blank" rel="noopener noreferrer"
                  style="background:${headerColor};border:1px solid ${headerColor};border-radius:10px;color:#ffffff;display:inline-block;font-size:16px;font-weight:700;letter-spacing:0.2px;line-height:1.2;padding:15px 36px;text-align:center;text-decoration:none;">
                  ${isCorrection ? 'Corrigir a minha ficha' : 'Preencher ficha de admissão'} →
                </a>
              </td>
            </tr>
          </table>

          <!-- LINK FALLBACK -->
          <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
            <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Ou copia o link diretamente</p>
            <p style="margin:0;word-break:break-all;font-size:13px;font-family:monospace;">
              <a href="${params.invitationLink}" target="_blank" rel="noopener noreferrer" style="color:${headerColor};text-decoration:underline;">${params.invitationLink}</a>
            </p>
          </div>

          <!-- EXPIRY NOTE -->
          <div style="display:flex;align-items:flex-start;gap:12px;background:#f0f9ff;border-radius:10px;padding:16px 20px;border:1px solid #bae6fd;">
            <span style="font-size:20px;flex-shrink:0;">⏱</span>
            <p style="margin:0;color:#0369a1;font-size:14px;line-height:1.6;">Este link é <strong>pessoal e intransmissível</strong> e expira em <strong>7 dias</strong>. Se o prazo expirar, responde a este processo junto da equipa de RH para receberes um novo convite.</p>
          </div>
        </td></tr>

        <!-- DIVIDER -->
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"></td></tr>

        <!-- FOOTER -->
        <tr><td style="padding:24px 40px;">
          <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;text-align:center;">Este email foi enviado automaticamente por <strong>Tlantic · Smarter Hub</strong>.</p>
          <p style="margin:0;color:#d1d5db;font-size:12px;text-align:center;">Em caso de dúvida, contacta a equipa de RH.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textFallback = [
    `Olá ${params.fullName},`,
    '',
    isCorrection
      ? 'Foi solicitada uma atualização no teu formulário de admissão da Tlantic.'
      : 'Bem-vindo(a) à Tlantic. O teu processo de admissão foi iniciado.',
    '',
    bodyText,
    ...(params.reviewReason ? ['', `Motivo: ${params.reviewReason}`] : []),
    '',
    'Link:',
    params.invitationLink,
    '',
    'Este link expira em 7 dias.',
  ].join('\n');

  await sendTransactionalEmail({
    to: params.personalEmail,
    subject,
    text: textFallback,
    html,
  });
}
