# The Home Plot Tracker — Home Assistant add-on image.
#
# The build context is this directory, so everything copied in has to be staged
# here first: `npm run build:addon` at the repository root compiles the three
# workspaces and writes the result into `rootfs/app/`.
#
# Base image notes, learned against Supervisor 2026.08:
#
#   * There is no `build.yaml`. Supervisor deprecated it — "Move build
#     parameters into the Dockerfile directly" — and `ARG BUILD_FROM` without
#     one fails with "base name ($BUILD_FROM) should not be blank". The base is
#     therefore named literally here.
#   * `node:22-alpine` is a multi-arch manifest list, so naming it literally
#     still builds correctly on both amd64 and aarch64: the daemon resolves the
#     digest for the architecture it is building for. That is what buys the
#     second architecture without a per-arch base image or a build argument.
#   * The server needs Node >= 22.6 for the built-in `node:sqlite` module, which
#     the distribution packages in the Home Assistant base image do not
#     reliably provide. Taking Node from its own image pins that exactly.
FROM node:22-alpine

# No io.hass.version label: Supervisor tags the built image with the version
# from config.yaml, so a second copy here would only drift out of sync.
LABEL \
  io.hass.name="The Home Plot Tracker" \
  io.hass.description="Plan garden beds, catalogue seed packets and log every harvest" \
  io.hass.type="addon" \
  org.opencontainers.image.source="https://github.com/Mptower/home-plot-tracker" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production

# rootfs/app  -> /app   (built server, built client, production manifest)
# rootfs/run.sh -> /run.sh
COPY rootfs /

# Only production dependencies, from a lockfile staged alongside the manifest.
# The single runtime dependency is Express; `node:sqlite` is part of Node and
# nothing here compiles, so there is no build toolchain in this image.
WORKDIR /app
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# Git may not carry the executable bit through every checkout; make sure.
RUN chmod a+x /run.sh

CMD ["/run.sh"]
