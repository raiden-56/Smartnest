// Runs before each test file (and before app modules are imported).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://smartnest:smartnest@localhost:5442/smartnest_test?schema=public';
process.env.COMMAND_TIMEOUT_MS = '2500';
process.env.LOG_LEVEL = 'silent';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.STREAM_TOKEN_SECRET ??= Buffer.alloc(32, 9).toString('hex');
