# Small Library Member App

## Run locally

1. Start PostgreSQL.
2. In the backend folder, run `npm run dev` to start the API on port 6000.
3. In this `frontend` folder, run `npm install`, then `npm run dev`.
4. Open the Vite URL shown in the terminal (usually `http://<server-ip>:5173`).

Vite proxies `/api` requests to `http://<your-server-ip>:6000`, so no separate CORS
configuration is needed for local development. Set `VITE_API_BASE_URL` if the
API is hosted at a different URL.

The app expects the backend routes for sign-in, books, loans, and reservations
to be available. Sign in with an existing member account.
