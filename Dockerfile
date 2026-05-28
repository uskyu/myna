FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl && \
    rm -rf /var/lib/apt/lists/*

# Install Hermes Agent from source
RUN git clone --depth 1 https://github.com/NousResearch/hermes-agent.git /root/hermes && \
    cd /root/hermes && \
    pip install --no-cache-dir -e . && \
    pip install --no-cache-dir anthropic httpx[socks]

# Install Myna backend dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir pymysql cryptography

# Copy application
COPY backend/ ./backend/
COPY src/web/public/ ./src/web/public/

# Create data directories
RUN mkdir -p /app/data /app/db /root/.hermes/profiles

WORKDIR /app/backend

EXPOSE 3456

CMD ["python3", "main.py"]
