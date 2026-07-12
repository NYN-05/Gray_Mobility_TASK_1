import { app } from './app';

// Keep the port configurable for local development and deployment environments.
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// The app is defined separately in app.ts so tests do not need to open a network port.
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
