# AIM Continuous Controls Monitoring

FastAPI application for continuous-controls monitoring, breach analytics,
review workflows, reporting, custom rules, and natural-language SQL queries.

## Local run

1. Create a virtual environment and install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and set at least:

   ```text
   AIM_JWT_SECRET=<long-random-secret>
   AIM_ADMIN_PASSWORD=<strong-unique-password>
   OPENAI_API_KEY=<OpenAI-key>
   ```

3. Start the service (`main.py` loads the root `.env` file automatically):

   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8001
   ```

Open `http://localhost:8001`. The health endpoint is
`http://localhost:8001/health`.

## Render deployment

The repository-root `render.yaml` defines the integrated application. Create a
Render Blueprint from this repository and enter the prompted secret values:

- `AIM_ADMIN_PASSWORD`: strong, unique production administrator password
- `OPENAI_API_KEY`: required for AI custom-rule generation and SQL GPT

`AIM_JWT_SECRET` is generated automatically by Render.

The default Blueprint uses Render's free web-service plan. Render's filesystem
is ephemeral on this plan, so SQLite databases and uploaded files are lost
after a restart or redeploy. For persistent production data:

1. Upgrade the service to a paid instance.
2. Attach a persistent disk mounted at `/var/data`.
3. Keep the storage environment variables from `render.yaml` unchanged.

Do not commit `.env`, databases, uploaded client files, or spreadsheets. They
are excluded by `.gitignore`.

## GitHub security note

If any credential was previously committed or exposed, revoke or rotate it.
Deleting it from the latest source does not remove it from Git history.
