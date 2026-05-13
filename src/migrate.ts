import { migrate, openDb } from './db.js';

const client = openDb();
try {
  await migrate(client);
} finally {
  client.close();
}
