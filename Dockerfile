# Judge container: offline tests + offline demo + static proof-page export.
# No secrets, no network at run time, no .env in the image.
#
#   docker build -t freshness-bound-recall .
#   docker run --rm freshness-bound-recall
#
# The image contains no credentials: .env is excluded by .dockerignore and the
# commands below never touch the live path.

FROM node:26.13.0-slim

WORKDIR /app

# Dependencies first (layer caching). --ignore-scripts: no lifecycle scripts run.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

# The project itself. .dockerignore keeps .env, node_modules and every runtime
# artifact out of the image.
COPY . .

# Default: prove the whole thing works without credentials or network.
CMD ["sh", "-c", "node --version && npm test && npm run demo:offline && npm run export && echo '--- static proof page written to /app/site/index.html ---' && ls -l site"]
