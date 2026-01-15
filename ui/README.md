# Nodo Feed API UI

This UI allows testing and interacting with the Nodo Feed API.

## Files

- **index.html**: Main HTML structure
- **styles.css**: CSS styles
- **app.js**: JavaScript functionality
- **package.json**: Build configuration for Cloudflare Pages

## Features

- Visual feed explorer
- Multiple JSON data views:
  - Compiled Feed
  - Tenant Mapping
  - Base Feed Config
  - Tenant Config
  - Content Categories
- Device and feed statistics
- Connection testing
- Improved loading state with cancel button
- Clear error handling

## Deployment

This project is deployed to Cloudflare Pages via GitHub integration.

The build command is configured to copy all necessary files to the dist directory:
```
mkdir -p dist && cp *.html *.css *.js dist/
```

Output directory: `dist` 