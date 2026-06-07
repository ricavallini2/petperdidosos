// Sentry (monitoramento de erros do backend).
// DEVE ser o PRIMEIRO import do servidor para a instrumentação automática
// (Express/HTTP) funcionar. Sem SENTRY_DSN definido, fica desativado (no-op).
import './env.js';
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,   // 10% das requisições para performance
  sendDefaultPii: false,   // não enviar IP/headers sensíveis (app lida com CPF/PIX)
});
