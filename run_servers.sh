#!/bin/bash
set -e

# Backend
cd /app/backend
npm install --silent
node server.js &

# Frontend
cd /app/frontend
npm install --silent
npm run dev &
