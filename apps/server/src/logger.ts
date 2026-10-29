import pino from 'pino';
import { config } from './config.js';

/**
 * Structured logger. Redaction paths make sure tokens, passwords, cookies and
 * camera credentials can never reach log output, even if accidentally passed.
 */
export const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.accessToken',
      '*.token',
      '*.code',
      '*.ciphertext',
      '*.authorization',
      'headers.authorization',
    ],
    censor: '[redacted]',
  },
  transport: !config.isProd && !config.isTest ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
});
