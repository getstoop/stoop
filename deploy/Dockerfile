# Multi-stage build producing a single static Stoop image.
# Build from the repo root: docker build -f deploy/Dockerfile .

# Stage 1: build the web app
FROM node:22-alpine AS web
WORKDIR /src/web
RUN corepack enable pnpm
# pnpm-workspace.yaml carries the allowed-build-scripts list (esbuild);
# without it pnpm refuses to run the postinstall and the install fails.
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# Stage 2: build the Go binary with the web app embedded
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist internal/webui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /stoop ./cmd/stoop

# Stage 3: minimal runtime. The volume mount points exist in the image,
# owned by the runtime user, so a fresh named volume inherits that
# ownership (see Dockerfile.goreleaser).
FROM busybox:1.37 AS dirs
RUN mkdir -p /out/data /out/livekit-keys && chown -R 65532:65532 /out

FROM gcr.io/distroless/static:nonroot
COPY --from=dirs --chown=65532:65532 /out/data /data
COPY --from=dirs --chown=65532:65532 /out/livekit-keys /livekit-keys
# On PATH, so `docker compose exec stoop stoop admin …` works in an image
# with no shell to resolve anything else.
COPY --from=build /stoop /usr/local/bin/stoop
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/stoop"]
