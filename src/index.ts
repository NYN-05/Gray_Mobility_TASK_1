import { app } from './app';

// Port configurable via env for local dev and deployment flexibility.
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// App is defined separately in app.ts so tests can import it without opening a port.
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
