# Vercel Deployment Guide

## Overview
This project is deployed as a single Vercel project with the frontend (Next.js) handling both the UI and API routes. The backend functionality is integrated into the frontend using Next.js API routes.

## Single Project Deployment

### 1. Deploy to Vercel
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build` (automatisk)
   - **Output Directory**: `.next` (automatisk)
   - **Install Command**: `npm install` (automatisk)

### 2. Environment Variables
Add these environment variables in Vercel dashboard:
```
NODE_ENV=production
```

## How It Works

### Vercel Configuration (vercel.json)
```json
{
  "version": 2,
  "builds": [
    {
      "src": "frontend/package.json",
      "use": "@vercel/next"
    },
    {
      "src": "backend/src/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/backend/src/index.js"
    },
    {
      "src": "/socket.io/(.*)",
      "dest": "/backend/src/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "/frontend/$1"
    }
  ]
}
```

### Route Handling
- **API routes** (`/api/*`): Handled by Express.js backend
- **WebSocket** (`/socket.io/*`): Handled by Socket.IO backend
- **All other routes**: Handled by Next.js frontend

### URL Structure
- **Frontend**: `https://your-app.vercel.app/`
- **Backend API**: `https://your-app.vercel.app/api/`
- **WebSocket**: `https://your-app.vercel.app/socket.io/`

## Benefits of Single Project

### ✅ **Simpler Deployment**
- One Vercel project instead of two
- No need to manage multiple URLs
- Easier environment variable management

### ✅ **Better Performance**
- Same domain for frontend and backend
- No CORS issues
- Faster WebSocket connections

### ✅ **Easier Maintenance**
- Single deployment pipeline
- Unified logging and monitoring
- Simpler debugging

## Important Notes

### WebSocket Support
- Vercel supports WebSocket connections for serverless functions
- Socket.IO works seamlessly in this setup
- No additional configuration needed

### CORS Configuration
The backend automatically allows connections from the same domain, so CORS is not an issue in production.

### Build Process
- Frontend builds with Next.js
- Backend deploys as serverless functions
- Both run on the same Vercel project

## Deployment Steps

1. **Connect Repository**
   - Link your GitHub repository to Vercel
   - Vercel will automatically detect the configuration

2. **Deploy**
   - Vercel will build both frontend and backend
   - All routes will be automatically configured

3. **Test**
   - Check WebSocket connection in browser console
   - Test Bluetooth settings functionality
   - Verify all features work in production

## Troubleshooting

### Build Failures
- Ensure root `package.json` has `install:all` script
- Check that all dependencies are properly listed
- Verify TypeScript compilation

### WebSocket Issues
- Check Vercel function logs for errors
- Verify routes are correctly configured
- Test with browser developer tools

### Environment Variables
- Make sure `NODE_ENV=production` is set
- No need for separate backend URL in production
