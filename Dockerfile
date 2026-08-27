FROM node:22-alpine

# Set working directory
WORKDIR /app

# Instalar dependências necessárias para compilação nativa (canvas) e ferramentas de vídeo/áudio
# git é necessário para instalar plugins via GitHub a partir da Web UI
RUN apk add --no-cache \
    build-base \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    ffmpeg \
    git \
    openssh-client

# Copy package files
COPY package*.json ./

# Install dependencies (reproducible build)
RUN npm ci

# Copy source code
COPY . .

# Create data directory just in case
RUN mkdir -p data

# Expose Web UI port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
