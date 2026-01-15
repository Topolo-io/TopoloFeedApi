/**
 * Admin API endpoint handler for the Feed API
 * This file handles admin-related functionality, but requires proper
 * authentication in a production environment.
 */

// Path patterns this handler will respond to
const ADMIN_PATH_PREFIX = '/admin';
const KV_PATH_PATTERN = new RegExp(`^${ADMIN_PATH_PREFIX}/kv/([^/]+)/([^/]+)$`);
const DEVICE_STATS_PATTERN = new RegExp(`^${ADMIN_PATH_PREFIX}/device-stats(?:/([^/]+))?$`);

/**
 * Check if a request path should be handled by the admin handler
 * @param {string} pathname - The URL pathname
 * @returns {boolean} True if this is an admin route
 */
export function isAdminRequest(pathname) {
    return pathname.startsWith(ADMIN_PATH_PREFIX);
}

/**
 * Handle admin API requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings including KV namespaces
 * @returns {Promise<Response>} The API response
 */
export async function handleAdminRequest(request, env) {
    const url = new URL(request.url);
    
    try {
        console.log(`Processing admin request: ${url.pathname}`);
        
        // For now, we only allow GET requests to the admin API
        if (request.method !== 'GET') {
            console.warn(`Method not allowed: ${request.method} for path ${url.pathname}`);
            return new Response(
                JSON.stringify({ error: 'Method not allowed. Only GET requests are supported.' }),
                { 
                    status: 405,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Allow': 'GET'
                    } 
                }
            );
        }
        
        // Device stats endpoint: /admin/device-stats/[deviceId]
        const deviceStatsMatch = url.pathname.match(DEVICE_STATS_PATTERN);
        if (deviceStatsMatch) {
            const deviceId = deviceStatsMatch[1];
            return await handleDeviceStatsRequest(deviceId, env);
        }
        
        // KV data retrieval endpoint: /admin/kv/:namespace/:key
        const kvMatch = url.pathname.match(KV_PATH_PATTERN);
        if (kvMatch) {
            const namespace = kvMatch[1];
            const key = kvMatch[2];
            
            console.log(`KV data request for namespace=${namespace}, key=${key}`);
            return await handleKVRequest(namespace, key, env);
        }
        
        // Handle other admin routes
        if (url.pathname === `${ADMIN_PATH_PREFIX}/info`) {
            return new Response(
                JSON.stringify({ 
                    api: 'Nodo Feed API',
                    version: '1.0',
                    kv_namespaces: ['NODO_FEED_CONFIG', 'NODO_STATE'],
                    environment: env.ENVIRONMENT || 'production'
                }),
                { 
                    status: 200,
                    headers: { 'Content-Type': 'application/json' } 
                }
            );
        }
        
        // Return 404 for unknown admin paths
        console.warn(`Unknown admin endpoint requested: ${url.pathname}`);
        return new Response(
            JSON.stringify({ error: 'Admin endpoint not found' }),
            { 
                status: 404,
                headers: { 'Content-Type': 'application/json' } 
            }
        );
    } catch (error) {
        console.error(`Unhandled error in admin request handler: ${error.message}`, error.stack);
        return new Response(
            JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            }),
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' } 
            }
        );
    }
}

/**
 * Handle device stats requests
 * @param {string|undefined} deviceId - The specific device ID or undefined for all devices
 * @param {Object} env - Environment bindings including KV namespaces
 * @returns {Promise<Response>} The API response with device stats
 */
async function handleDeviceStatsRequest(deviceId, env) {
    try {
        if (deviceId) {
            // Get stats for a specific device
            const statsKey = `device:${deviceId}:stats`;
            const stats = await env.NODO_STATE.get(statsKey, 'json');
            
            if (stats === null) {
                return new Response(
                    JSON.stringify({ error: `No stats found for device: ${deviceId}` }),
                    { 
                        status: 404,
                        headers: { 'Content-Type': 'application/json' } 
                    }
                );
            }
            
            return new Response(
                JSON.stringify(stats),
                { 
                    status: 200,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*', // For testing only
                        'Cache-Control': 'no-store'
                    } 
                }
            );
        } else {
            // List all device stats keys (just the keys, not the values)
            // This is efficient even with many devices
            const deviceStatsKeys = await env.NODO_STATE.list({ prefix: 'device:' });
            
            // Extract just the device IDs from the keys
            const deviceIds = deviceStatsKeys.keys.map(key => {
                const match = key.name.match(/^device:(.+):stats$/);
                return match ? match[1] : key.name;
            });
            
            return new Response(
                JSON.stringify({ 
                    devices: deviceIds,
                    count: deviceIds.length,
                    message: 'For detailed stats, append the device ID to the URL'
                }),
                { 
                    status: 200,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*', // For testing only
                        'Cache-Control': 'no-store'
                    } 
                }
            );
        }
    } catch (error) {
        console.error(`Error retrieving device stats: ${error.message}`, error.stack);
        return new Response(
            JSON.stringify({ 
                error: 'Failed to retrieve device stats',
                message: error.message,
                type: error.name
            }),
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' } 
            }
        );
    }
}

/**
 * Handle KV data retrieval
 * @param {string} namespaceName - The KV namespace name
 * @param {string} key - The key to retrieve
 * @param {Object} env - Environment bindings including KV namespaces
 * @returns {Promise<Response>} The API response with the KV data
 */
async function handleKVRequest(namespaceName, key, env) {
    // Get the actual KV namespace
    let namespace;
    switch (namespaceName) {
        case 'NODO_FEED_CONFIG':
            namespace = env.NODO_FEED_CONFIG;
            break;
        case 'NODO_STATE':
            namespace = env.NODO_STATE;
            break;
        default:
            console.warn(`Requested unknown KV namespace: ${namespaceName}`);
            return new Response(
                JSON.stringify({ error: `Unknown KV namespace: ${namespaceName}` }),
                { 
                    status: 404,
                    headers: { 'Content-Type': 'application/json' } 
                }
            );
    }
    
    if (!namespace) {
        console.error(`KV namespace binding '${namespaceName}' is undefined. Check your wrangler.toml configuration.`);
        return new Response(
            JSON.stringify({ 
                error: `KV namespace binding '${namespaceName}' is missing.`,
                details: "This may indicate a configuration issue with the Worker."
            }),
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' } 
            }
        );
    }
    
    // Attempt to read the KV data
    try {
        console.log(`Fetching data from ${namespaceName} with key: ${key}`);
        const value = await namespace.get(key, 'json');
        
        if (value === null) {
            console.warn(`Key not found in KV: ${namespaceName}/${key}`);
            return new Response(
                JSON.stringify({ error: `Key not found: ${key}` }),
                { 
                    status: 404,
                    headers: { 'Content-Type': 'application/json' } 
                }
            );
        }
        
        console.log(`Successfully retrieved data for ${namespaceName}/${key}`);
        return new Response(
            JSON.stringify(value),
            { 
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*', // For testing only
                    'Cache-Control': 'no-store'
                } 
            }
        );
    } catch (error) {
        console.error(`Error retrieving KV data for ${namespaceName}/${key}: ${error.message}`, error.stack);
        return new Response(
            JSON.stringify({ 
                error: `Failed to retrieve key ${key} from ${namespaceName}`,
                message: error.message,
                type: error.name
            }),
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' } 
            }
        );
    }
} 