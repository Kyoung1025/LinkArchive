import pino from 'pino';

type LogFields = Record<string, unknown>;

const base = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'worker' },
  messageKey: 'message',
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: (label) => ({ level: label }) },
});

export const logger = {
  info: (message: string, fields?: LogFields) => base.info(fields ?? {}, message),
  warn: (message: string, fields?: LogFields) => base.warn(fields ?? {}, message),
  error: (message: string, fields?: LogFields) => base.error(fields ?? {}, message),
};
