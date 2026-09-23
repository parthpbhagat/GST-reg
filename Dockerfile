# Use official Playwright image which already has all OS dependencies for Chromium
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /usr/src/app

# Copy package files for both backend and automation
COPY backend/package*.json ./backend/
COPY automation/package*.json ./automation/

# Install dependencies for both
RUN cd backend && npm install
RUN cd automation && npm install

# Copy all project files (frontend isn't needed for backend, but we copy everything for simplicity, or just backend+automation)
COPY backend/ ./backend/
COPY automation/ ./automation/

# Expose backend port
EXPOSE 3002

# Set working directory to backend so server.js runs properly
WORKDIR /usr/src/app/backend

CMD ["node", "server.js"]
