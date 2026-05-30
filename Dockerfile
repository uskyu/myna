FROM python:3.11-slim

WORKDIR /app

# System deps + Docker CLI (for self-update via mounted docker.sock)
# + Playwright/Chromium system dependencies for browser tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates gnupg \
    # Playwright Chromium deps
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libwayland-client0 \
    fonts-noto-cjk fonts-noto-color-emoji && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Install Hermes Agent from source
RUN git clone --depth 1 https://github.com/NousResearch/hermes-agent.git /root/hermes && \
    cd /root/hermes && \
    pip install --no-cache-dir -e . && \
    pip install --no-cache-dir anthropic httpx[socks]

# Install Playwright browsers (Chromium only, ~400MB)
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright
RUN pip install --no-cache-dir playwright && \
    playwright install chromium && \
    chmod -R 755 /opt/hermes/.playwright

# Install Myna backend dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir pymysql cryptography

# Copy application
COPY backend/ ./backend/
COPY src/web/public/ ./src/web/public/

# Version (injected at build time by CI)
ARG MYNA_VERSION=dev
ENV MYNA_VERSION=${MYNA_VERSION}

# Create persistent data directories. In Docker, /app/db and /app/data are volumes.
RUN mkdir -p /app/data/uploads /app/data/workspaces /app/db /root/.hermes/profiles

WORKDIR /app/backend

EXPOSE 3456

CMD ["python3", "main.py"]
