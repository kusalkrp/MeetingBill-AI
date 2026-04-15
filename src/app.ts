import express from 'express';
import { logger } from './utils/logger';
import { env } from './config/env';

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(3000, () => {
  logger.info({ event: 'server_start', port: 3000 }, 'MeetingBill API listening on port 3000');
});
