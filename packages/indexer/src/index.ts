import { startServer } from './server';

startServer().catch((err) => {
  console.error('Indexer failed to start:', err);
  process.exit(1);
});
