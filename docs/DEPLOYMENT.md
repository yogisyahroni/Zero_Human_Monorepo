# Deployment

## GitHub Actions

The `Staging` workflow validates the monorepo in this order:

1. Build the HR dashboard frontend.
2. Test HR/admin service.
3. Build and test Brain/auth service.
4. Build and test Router service.
5. Validate Docker Compose.
6. Run a critical dependency audit and secret-pattern scan.
7. Build adapter Docker images and push them to GitHub Container Registry on `main`.
8. Deploy over SSH when server secrets are configured.
9. Validate `/api/health` when `STAGING_URL` is configured.

Deploy is intentionally safe by default. If server secrets are missing, the deploy job stays green and writes a skip note.

## Required GitHub Secrets For Server Deploy

- `DEPLOY_HOST`: server IP or domain.
- `DEPLOY_USER`: SSH user.
- `DEPLOY_SSH_KEY`: private key allowed to deploy.
- `DEPLOY_PORT`: optional SSH port. Defaults to `22`.
- `STAGING_URL`: optional public URL, for example `https://zero-human.example.com`.

## Server Requirements

- Docker Engine with Compose v2.
- Outbound access to `ghcr.io`.
- A reverse proxy such as Nginx, Caddy, or Traefik pointing your domain to `localhost:3003`.

The workflow deploys `deploy/docker-compose.staging.yml` and uses these images:

- `${ZH_IMAGE_PREFIX}/zh-router`
- `${ZH_IMAGE_PREFIX}/zh-brain`
- `${ZH_IMAGE_PREFIX}/zh-hr`

Set `ZERO_HUMAN_PORT` on the server if you want to expose a different host port.
