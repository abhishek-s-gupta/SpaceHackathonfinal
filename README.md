# Aegis · Mission Operations Copilot

A local-only spacecraft operations simulation for hackathon problem ST-10. This is a simulation; it does not connect to a spacecraft or represent real telemetry.

## Run locally

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` for live investigations (optional; demo fallback works without it).
4. Run `npm run dev` and open <http://localhost:5173>.

The Gemini key stays on the local backend and is never sent to the browser. Uploaded PDFs are parsed and indexed in local memory; only a few matching excerpts are included in an investigation. The included incidents and telemetry are explicitly simulated/demo data.
