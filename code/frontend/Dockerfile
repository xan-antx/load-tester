# Production build of the React app, served by nginx (used by docker-compose.yml).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Where the browser finds the API. In docker compose, nginx below serves the
# app and proxies /api to the backend, so both live on the same origin.
ARG VITE_API_BASE=http://localhost:8080
# Optional: open the app already filled in for the local mock target.
ARG VITE_DEFAULT_TARGET=
ARG VITE_DEFAULT_SAMPLE=
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_DEFAULT_TARGET=$VITE_DEFAULT_TARGET \
    VITE_DEFAULT_SAMPLE=$VITE_DEFAULT_SAMPLE
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
