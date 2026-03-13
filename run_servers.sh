#!/bin/bash
set -e

# Backend
cd /app/backend
npm install
node server.js &

# Frontend
cd /app/frontend
npm install
npm run dev &
