FROM node:18-alpine

# Set working directory
WORKDIR /app

# Instalar dependências necessárias para compilação nativa (canvas) e ferramentas de vídeo/áudio
RUN apk add --no-cache \
    build-base \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    ffmpeg

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create data directory just in case
RUN mkdir -p data

# Expose Web UI port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
