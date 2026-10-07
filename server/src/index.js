const createApp = require('./app');

const PORT = process.env.PORT ?? 4000;

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`promiscope backend listening on port ${PORT}`);
});

// Drop requests that take longer than this to arrive in full (slowloris).
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000);
