#!/bin/sh
set -e

# Capture runtime UID/GID from environment variables, defaulting to 1000
PUID=${USER_UID:-1000}
PGID=${USER_GID:-1000}

# Adjust the node user's UID/GID if they differ from the runtime request
# and fix volume ownership only when a remap is needed
changed=0

if [ "$(id -u node)" -ne "$PUID" ]; then
    echo "Updating node UID to $PUID"
    usermod -o -u "$PUID" node
    changed=1
fi

if [ "$(id -g node)" -ne "$PGID" ]; then
    echo "Updating node GID to $PGID"
    groupmod -o -g "$PGID" node
    usermod -g "$PGID" node
    changed=1
fi

if [ "$changed" = "1" ]; then
    chown -R node:node /paperclip
fi

CODEX_HOME_DIR="${CODEX_HOME:-/paperclip/.codex}"
CODEX_ROUTER_BASE_URL="${CODEX_OPENAI_BASE_URL:-${OPENAI_BASE_URL:-http://9router:20128/v1}}"
CODEX_ROUTER_MODEL="${CODEX_MODEL:-combotest}"

if [ "${ZH_ENABLE_CODEX_9ROUTER_CONFIG:-true}" = "true" ]; then
    mkdir -p "$CODEX_HOME_DIR"
    cat > "$CODEX_HOME_DIR/config.toml" <<EOF
model_provider = "9router"
model = "$CODEX_ROUTER_MODEL"

[model_providers.9router]
name = "9Router"
base_url = "$CODEX_ROUTER_BASE_URL"
env_key = "OPENAI_API_KEY"
wire_api = "responses"

[projects."/app"]
trust_level = "trusted"

[projects."/paperclip"]
trust_level = "trusted"
EOF

    for managed_home in /paperclip/instances/default/companies/*/codex-home; do
        if [ -d "$managed_home" ]; then
            cp "$CODEX_HOME_DIR/config.toml" "$managed_home/config.toml"
        fi
    done

    chown -R node:node "$CODEX_HOME_DIR" /paperclip/instances 2>/dev/null || true
fi

exec gosu node "$@"
