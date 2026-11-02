export const config = {
  port: Number(process.env.PORT ?? 8080),
  // 'localhost' covers both IPv4 and IPv6.
  host: process.env.HOST ?? 'localhost',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // Opt-in, so a missing env var never enables demo login.
  demoMode: process.env.DEMO_MODE === 'true',
  // Persistent PGlite folder. Required outside demo mode; unset in demo mode = in-memory.
  databaseDir: process.env.DATABASE_DIR,
  timeZone: 'Europe/Stockholm',
  support: {
    phone: '+46 8 123 456 78',
    email: 'support@qred.example',
    chatUrl: 'https://qred.example/support/chat',
  },
} as const;
