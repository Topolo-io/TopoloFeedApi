# Nodo Feed API

This Cloudflare Worker provides a dynamic media feed API for devices. The API compiles a custom media playlist based on tenant configurations and device assignments.

## Features

- **Device-specific feeds**: Each device receives a customized media feed based on its tenant assignment
- **Tenant configuration**: Configure different content for different tenants
- **Content categories**: Enable or disable specific content categories per tenant
- **Device management**: Device lists are maintained in KV for easy updates
- **Device statistics**: View device access statistics via the admin API

## API Endpoints

### Main Feed API

```
GET https://nodo-feed-api.topolo.app/{deviceId}
```

Returns a JSON array of media items tailored for the specified device.

Example response:
```json
[
  {
    "id": "jc-001",
    "type": "image",
    "url": "https://example.com/image1.jpg",
    "duration": 15
  },
  {
    "id": "base-001",
    "type": "video",
    "url": "https://example.com/video1.mp4",
    "duration": 30
  }
]
```

### Admin API (Read-Only)

```
GET https://nodo-feed-api.topolo.app/admin/kv/{namespace}/{key}
```

Retrieves configuration data from the specified KV namespace and key. Limited to read-only for security.

```
GET https://nodo-feed-api.topolo.app/admin/device-stats
```

Lists all devices that have accessed the API.

```
GET https://nodo-feed-api.topolo.app/admin/device-stats/{deviceId}
```

Retrieves detailed statistics for a specific device, including the total number of requests, daily request counts, and information about the last request.

## User Interface

The API comes with a simple web UI for testing and visualizing feed configurations:

- **Feed Explorer**: View the generated feed for any device ID
- **KV Admin**: View and explore configuration data in KV storage

### Using the Feed Explorer

1. Visit [https://nodo-feed-api.topolo.app/](https://nodo-feed-api.topolo.app/)
2. Enter a device ID in the form
3. View the visual representation of the feed with all media items
4. Switch to the JSON tab to see the raw API response

### Using the KV Admin

1. Visit [https://nodo-feed-api.topolo.app/kv-admin.html](https://nodo-feed-api.topolo.app/kv-admin.html)
2. Select the KV namespace and key you want to view
3. Explore the JSON configuration in the editor

## Configuration Structure

The API uses two KV namespaces:

### NODO_FEED_CONFIG

Contains the feed configuration data:

- `tenant-mapping`: Maps device IDs to tenant configurations
- `feed`: Base feed configuration shared across tenants
- `{tenant}_tenant`: Tenant-specific configurations
- Various content category configurations
- `static:ui/index.html` and `static:ui/kv-admin.html`: Static UI files

### NODO_STATE

Contains operational state data:

- `{tenantId}:tenant:deviceList`: Lists of device IDs assigned to each tenant
- `device:{deviceId}:stats`: Statistics about device API access (uses an efficient aggregated format)

## Device Statistics

The API tracks device access statistics using an efficient aggregation approach instead of logging each request individually. Statistics include:

- Total requests made by the device
- Daily request counts (past 30 days)
- Details about the device's last request

These statistics can be viewed via the admin API endpoint `/admin/device-stats/{deviceId}`.

## Deployment

### Initial Setup

1. Install Wrangler: `npm install -g wrangler`
2. Login to Cloudflare: `wrangler login`
3. Create KV namespaces:
   ```
   wrangler kv namespace create NODO_FEED_CONFIG
   wrangler kv namespace create NODO_STATE
   ```
4. Update `wrangler.toml` with the namespace IDs from the previous commands

### Deployment Steps

1. Install dependencies: `npm install`
2. Deploy the worker: `npm run deploy`
3. Upload initial configuration data to KV:
   ```
   wrangler kv key put "tenant-mapping" --binding=NODO_FEED_CONFIG --path=json_examples/tenant-mapping.json
   wrangler kv key put "feed" --binding=NODO_FEED_CONFIG --path=json_examples/feed.json
   ```
4. Upload UI files to KV:
   ```
   wrangler kv key put "static:ui/index.html" --binding=NODO_FEED_CONFIG --path=ui/index.html
   wrangler kv key put "static:ui/kv-admin.html" --binding=NODO_FEED_CONFIG --path=ui/kv-admin.html
   ```
5. Upload device lists:
   ```
   wrangler kv key put "justcook:tenant:deviceList" --binding=NODO_STATE --value='["device1", "device2", "device3"]'
   ```

### Testing Locally

1. Start the development server: `npm run dev`
2. Access the local version at: `http://localhost:8787/`

### Updating Configuration

You can update configuration at any time without redeploying the worker:

```
wrangler kv key put "justcook_tenant" --binding=NODO_FEED_CONFIG --path=json_examples/justcook.json
```

## Device Management

The project includes a utility script for managing device lists in the NODO_STATE namespace. This makes it easy to add or remove devices from tenant device lists.

### Using the Device Management Script

You can use either the direct script or the NPM scripts:

#### Using NPM Scripts

```bash
# List all devices for a tenant
npm run devices:list justcook

# Add a device to a tenant
npm run devices:add justcook device123

# Remove a device from a tenant
npm run devices:remove justcook device123
```

#### Using the Script Directly

```bash
# List all devices for a tenant
node scripts/manage-devices.js list justcook

# Add a device to a tenant
node scripts/manage-devices.js add justcook device123

# Remove a device from a tenant
node scripts/manage-devices.js remove justcook device123
```

## Security Notes

- Admin API is read-only for safety
- Consider adding authentication for production use
- Restrict CORS in production environments
- Use environment-specific variables for different environments 

## Logging Configuration

Request logging can be enabled or disabled via the security configuration. By default, it's set to disabled to prevent KV storage from being filled with unnecessary log entries. When enabled, it uses an efficient aggregated approach that stores statistics per device rather than individual log entries.

To enable or disable logging:

```
wrangler kv key put "security-config" --binding=NODO_FEED_CONFIG --json='{"logAllRequests": false}'
``` 