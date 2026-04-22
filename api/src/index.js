// Import admin functionality
import { isAdminRequest, handleAdminRequest } from './admin.js';

// Main constants
const TENANT_MAPPING_KEY = "tenant-mapping";
const BASE_FEED_CONFIG_KEY = "feed";
const SECURITY_CONFIG_KEY = "security-config";

// Define standardized error codes for the API
const ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
};

// Centralized error handling function
function createErrorResponse(errorCode, message, details = null, statusCode = 400) {
  const errorResponse = {
    error: {
      code: errorCode,
      message: message
    }
  };
  
  // Add details if provided
  if (details) {
    errorResponse.error.details = details;
  }
  
  // Map error codes to appropriate HTTP status codes if not provided
  if (!statusCode) {
    switch (errorCode) {
      case ERROR_CODES.INVALID_REQUEST:
        statusCode = 400; // Bad Request
        break;
      case ERROR_CODES.UNAUTHORIZED:
        statusCode = 401; // Unauthorized
        break;
      case ERROR_CODES.FORBIDDEN:
        statusCode = 403; // Forbidden
        break;
      case ERROR_CODES.NOT_FOUND:
        statusCode = 404; // Not Found
        break;
      case ERROR_CODES.RATE_LIMITED:
        statusCode = 429; // Too Many Requests
        break;
      case ERROR_CODES.CONFIGURATION_ERROR:
      case ERROR_CODES.VALIDATION_ERROR:
        statusCode = 400; // Bad Request
        break;
      case ERROR_CODES.SERVER_ERROR:
      default:
        statusCode = 500; // Internal Server Error
    }
  }
  
  return new Response(JSON.stringify(errorResponse), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

// Default security configuration (used if none found in KV)
const DEFAULT_SECURITY_CONFIG = {
  enforceApiKey: false,        // When true, requires valid X-API-Key header
  enforceDeviceIdValidation: false, // When true, requires device ID to be registered
  rateLimitRequests: 100,      // Max requests per IP per minute
  enforceHttps: true,          // Redirects HTTP to HTTPS
  logAllRequests: true         // Log all requests to KV store
};

// In-memory rate limiting storage (reset every minute)
// In production, consider using Cloudflare Workers Durable Objects or KV with TTL for distributed rate limiting
let rateLimits = {};
let rateLimitIntervalSet = false;

// CORS configuration
// Separate CORS handling for admin/web interfaces vs Android devices
const ADMIN_ALLOWED_ORIGINS = [
  "https://nodo.topolo.app",
  "https://admin.nodo.topolo.app",
  "https://dev.nodo.topolo.app"
  // Add more web admin origins as needed
];

// Helper function to check if an origin is an allowed admin origin
function isAllowedAdminOrigin(origin) {
  return ADMIN_ALLOWED_ORIGINS.includes(origin);
}

// Helper function to get CORS headers based on the request
function getCorsHeaders(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  
  // For admin routes, apply strict CORS
  if (isAdminRequest(url.pathname)) {
    if (origin && isAllowedAdminOrigin(origin)) {
      return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      };
    }
    // For unauthorized admin access, return empty headers (blocking access)
    return {};
  }
  
  // For device feed API routes, we need to be permissive
  // but secure this with other authentication mechanisms
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID, X-API-Key',
    'Access-Control-Max-Age': '86400'
  };
}

// Add CORS headers to error responses
function addCorsToResponse(response, request) {
  const corsHeaders = getCorsHeaders(request);
  const newHeaders = new Headers(response.headers);
  
  // Add CORS headers
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// Helper function to enforce HTTPS
function enforceHttps(request) {
  const url = new URL(request.url);
  if (url.protocol === 'http:') {
    return new Response('Redirect to HTTPS', {
      status: 301,
      headers: { 'Location': url.href.replace('http:', 'https:') }
    });
  }
  return null;
}

// Helper function to validate API key (if enabled)
async function validateApiKey(request, securityConfig, env) {
  if (!securityConfig.enforceApiKey) {
    return { valid: true, reason: 'API key validation not enforced' };
  }
  
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) {
    return { valid: false, reason: 'Missing API key' };
  }
  
  try {
    // Here we would check if the API key is valid
    // This example uses a simple check against KV store
    const validKey = await env.TOPOLO_STATE.get(`apikey:${apiKey}`);
    return { 
      valid: validKey !== null, 
      reason: validKey !== null ? 'Valid API key' : 'Invalid API key' 
    };
  } catch (error) {
    console.error('Error validating API key:', error);
    // Fail open in case of error (this can be changed to fail closed)
    return { valid: true, reason: 'API key validation error, failing open' };
  }
}

// Helper function to validate device ID (if enabled)
async function validateDeviceId(deviceId, securityConfig, env) {
  if (!securityConfig.enforceDeviceIdValidation) {
    return { valid: true, reason: 'Device ID validation not enforced' };
  }
  
  if (!deviceId) {
    return { valid: false, reason: 'Missing device ID' };
  }
  
  try {
    // Here we would check if the device ID is registered
    // This example uses a simple check against KV store
    const validDevice = await env.TOPOLO_STATE.get(`device:${deviceId}`);
    return { 
      valid: validDevice !== null, 
      reason: validDevice !== null ? 'Valid device ID' : 'Unregistered device ID' 
    };
  } catch (error) {
    console.error('Error validating device ID:', error);
    // Fail open in case of error (this can be changed to fail closed)
    return { valid: true, reason: 'Device ID validation error, failing open' };
  }
}

// Helper function to check rate limits
function checkRateLimit(request, securityConfig) {
  if (!securityConfig.rateLimitRequests || securityConfig.rateLimitRequests <= 0) {
    return { valid: true, reason: 'Rate limiting not enabled' };
  }
  
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  
  if (!rateLimits[clientIp]) {
    rateLimits[clientIp] = 1;
  } else {
    rateLimits[clientIp]++;
  }
  
  const currentCount = rateLimits[clientIp];
  const isWithinLimit = currentCount <= securityConfig.rateLimitRequests;
  
  return { 
    valid: isWithinLimit, 
    reason: isWithinLimit ? `Rate limit OK (${currentCount}/${securityConfig.rateLimitRequests})` : 'Rate limit exceeded',
    count: currentCount,
    limit: securityConfig.rateLimitRequests
  };
}

// Helper function to log request (if enabled)
async function logRequest(request, deviceId, securityInfo, env, wasSuccess = true) {
  // Skip logging if disabled
  if (!securityInfo.config.logAllRequests) {
    return;
  }
  
  try {
    const timestamp = new Date().toISOString();
    const date = timestamp.split('T')[0]; // Just the date portion YYYY-MM-DD
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const url = request.url;
    const method = request.method;
    
    // Create a more efficient log structure - we'll use a counter per device per day
    // and store the last access timestamp
    const deviceKey = `device:${deviceId || 'unknown'}:stats`;
    
    // Try to get existing stats
    let stats = null;
    try {
      stats = await env.TOPOLO_STATE.get(deviceKey, 'json');
    } catch (error) {
      // If there's an error or no existing stats, create a new object
      console.warn(`Could not fetch existing stats for ${deviceId}: ${error?.message}`);
    }
    
    // Initialize stats if they don't exist
    if (!stats) {
      stats = {
        totalRequests: 0,
        dailyRequests: {},
        lastAccess: {
          timestamp: null,
          clientIp: null,
          userAgent: null,
          url: null,
          method: null,
          wasSuccess: null
        }
      };
    }
    
    // Update stats
    stats.totalRequests++;
    
    // Increment or initialize daily counter
    if (!stats.dailyRequests[date]) {
      stats.dailyRequests[date] = 1;
    } else {
      stats.dailyRequests[date]++;
    }
    
    // Clean up old daily stats (keep only last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
    
    Object.keys(stats.dailyRequests).forEach(day => {
      if (day < cutoffDate) {
        delete stats.dailyRequests[day];
      }
    });
    
    // Update last access info
    stats.lastAccess = {
      timestamp,
      clientIp,
      userAgent,
      url,
      method,
      securityInfo: {
        apiKeyValid: securityInfo.apiKey.valid,
        deviceIdValid: securityInfo.deviceId.valid,
        rateLimit: {
          count: securityInfo.rateLimit.count,
          limit: securityInfo.rateLimit.limit
        }
      },
      wasSuccess
    };
    
    // Store updated stats with a 90-day TTL (7776000 seconds)
    await env.TOPOLO_STATE.put(deviceKey, JSON.stringify(stats), { expirationTtl: 7776000 });
  } catch (error) {
    console.error('Error logging request:', error);
    // Non-critical operation, so just log the error and continue
  }
}

// Helper function to get security configuration
async function getSecurityConfig(env) {
  try {
    const securityConfig = await fetchFromKV(env.TOPOLO_FEED_CONFIG, SECURITY_CONFIG_KEY, "json");
    return { ...DEFAULT_SECURITY_CONFIG, ...securityConfig };
  } catch (error) {
    console.warn('Could not load security config, using defaults:', error);
    return DEFAULT_SECURITY_CONFIG;
  }
}

export default {
  // Main fetch handler
  async fetch(request, env, ctx) {
    try {
      // Set up rate limit reset interval if not already set
      if (!rateLimitIntervalSet) {
        // Use setTimeout instead of setInterval for one-time scheduling
        // Schedule the rate limit reset for one minute from now
        ctx.waitUntil(
          new Promise(resolve => {
            setTimeout(() => {
              rateLimits = {};
              resolve();
            }, 60000)
          })
        );
        rateLimitIntervalSet = true;
      }
      
      // Get security configuration
      const securityConfig = await getSecurityConfig(env);
      
      // Handle CORS preflight requests first
      if (request.method === 'OPTIONS') {
        const corsHeaders = getCorsHeaders(request);
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }
      
      // Enforce HTTPS if enabled
      if (securityConfig.enforceHttps) {
        const httpsRedirect = enforceHttps(request);
        if (httpsRedirect) return httpsRedirect;
      }
      
      // Check rate limit
      const rateLimitCheck = checkRateLimit(request, securityConfig);
      if (!rateLimitCheck.valid) {
        const errorResponse = createErrorResponse(
          ERROR_CODES.RATE_LIMITED,
          'Rate limit exceeded',
          {
            current: rateLimitCheck.count,
            limit: rateLimitCheck.limit,
            reset: '60 seconds'
          },
          429
        );
        // Add rate limit headers
        const headers = new Headers(errorResponse.headers);
        headers.set('Retry-After', '60');
        headers.set('X-RateLimit-Limit', rateLimitCheck.limit.toString());
        headers.set('X-RateLimit-Remaining', '0');
        
        // Add CORS headers
        const corsHeaders = getCorsHeaders(request);
        for (const [key, value] of Object.entries(corsHeaders)) {
          headers.set(key, value);
        }
        
        return new Response(errorResponse.body, {
          status: errorResponse.status,
          headers: headers
        });
      }
      
      // Process the request
      return await router(request, env, securityConfig, rateLimitCheck);
    } catch (error) {
      console.error('Unhandled exception in fetch handler:', error);
      const errorResponse = createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        'An unexpected error occurred',
        { message: error.message },
        500
      );
      return addCorsToResponse(errorResponse, request);
    }
  }
};

// Main router function to handle all incoming requests
async function router(request, env, securityConfig, rateLimitCheck) {
  try {
    const url = new URL(request.url);
    
    // Admin routes
    if (isAdminRequest(url.pathname)) {
      return handleAdminRequest(request, env);
    }
    
    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/ping') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            ...getCorsHeaders(request)
          }
        }
      );
    }
    
    // API routes - device feed
    const pathParts = url.pathname.split('/').filter(part => part.length > 0);
    
    // If it's the root path with no device ID, provide a help response
    if (pathParts.length === 0) {
      return new Response(
        JSON.stringify({
          api: 'Nodo Feed API',
          version: '1.0',
          usage: 'Access media feeds by using /{deviceId}',
          endpoints: {
            '/{deviceId}': 'Get media feed for specific device',
            '/health': 'Health check endpoint'
          }
        }),
        {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            ...getCorsHeaders(request)
          }
        }
      );
    }
    
    if (pathParts.length === 1) {
      const deviceId = pathParts[0];
      if (deviceId === 'favicon.ico') {
        return new Response(null, { status: 404 });
      }
      return handleRequest(request, env, securityConfig, rateLimitCheck);
    }
    
    // 404 for everything else
    const errorResponse = createErrorResponse(
      ERROR_CODES.NOT_FOUND,
      'Resource not found',
      { path: url.pathname },
      404
    );
    return addCorsToResponse(errorResponse, request);
  } catch (error) {
    console.error('Unhandled exception in router:', error);
    const errorResponse = createErrorResponse(
      ERROR_CODES.SERVER_ERROR,
      'An unexpected error occurred',
      { message: error.message },
      500
    );
    return addCorsToResponse(errorResponse, request);
  }
}

// Main handler for feed API requests
async function handleRequest(request, env, securityConfig, rateLimitCheck) {
  console.log('In handleRequest. KV bindings available:', typeof env.TOPOLO_FEED_CONFIG, typeof env.TOPOLO_STATE);
  const url = new URL(request.url);

  try {
    // Extract deviceId from path parameter
    const pathParts = url.pathname.split('/').filter(part => part.length > 0);
    let deviceId = null;

    if (pathParts.length === 1) {
      deviceId = pathParts[0];
      // Optional: Add validation here if deviceId has a specific format
      if (deviceId === 'favicon.ico') {
          return new Response(null, { status: 404 });
      }
    } else {
      // If path is just "/" or has multiple segments like "/foo/bar", it's not the expected format.
      const errorResponse = createErrorResponse(
        ERROR_CODES.INVALID_REQUEST,
        'Invalid URL format',
        { expected: '/deviceId', received: url.pathname },
        400
      );
      return addCorsToResponse(errorResponse, request);
    }

    console.log(`Extracted deviceId: ${deviceId} from path: ${url.pathname}`);

    if (!deviceId) {
      const errorResponse = createErrorResponse(
        ERROR_CODES.INVALID_REQUEST,
        'Missing deviceId in URL path',
        null,
        400
      );
      return addCorsToResponse(errorResponse, request);
    }

    // Validate API key (if enabled)
    const apiKeyCheck = await validateApiKey(request, securityConfig, env);
    
    // Validate device ID (if enabled)
    const deviceIdCheck = await validateDeviceId(deviceId, securityConfig, env);
    
    // Combine security info for logging
    const securityInfo = {
      config: securityConfig,
      apiKey: apiKeyCheck,
      deviceId: deviceIdCheck,
      rateLimit: rateLimitCheck
    };
    
    // Check security validations (if enforced)
    if ((securityConfig.enforceApiKey && !apiKeyCheck.valid) || 
        (securityConfig.enforceDeviceIdValidation && !deviceIdCheck.valid)) {
      // Log failed request
      await logRequest(request, deviceId, securityInfo, env, false);
      
      const reason = !apiKeyCheck.valid ? apiKeyCheck.reason : deviceIdCheck.reason;
      const errorResponse = createErrorResponse(
        ERROR_CODES.UNAUTHORIZED,
        'Authentication required',
        { reason: reason },
        401
      );
      return addCorsToResponse(errorResponse, request);
    }

    try {
      const mediaFeed = await compileMediaFeed(deviceId, env);
      
      // Log successful request
      await logRequest(request, deviceId, securityInfo, env, true);
      
      return new Response(JSON.stringify(mediaFeed), {
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'private, max-age=300', // Cache for 5 minutes
          ...getCorsHeaders(request)
        },
      });
    } catch (error) {
      console.error(`Error compiling media feed for device ${deviceId}:`, error.stack);
      
      // Log failed request
      await logRequest(request, deviceId, securityInfo, env, false);
      
      let errorCode = ERROR_CODES.SERVER_ERROR;
      let statusCode = 500;
      
      // Determine appropriate error code based on error message
      if (error.message.includes('not found') || error.message.includes('missing')) {
        errorCode = ERROR_CODES.NOT_FOUND;
        statusCode = 404;
      } else if (error.message.includes('Configuration') || error.message.includes('config')) {
        errorCode = ERROR_CODES.CONFIGURATION_ERROR;
        statusCode = 400;
      } else if (error.message.includes('Invalid') || error.message.includes('validation')) {
        errorCode = ERROR_CODES.VALIDATION_ERROR;
        statusCode = 400;
      }
      
      const errorResponse = createErrorResponse(
        errorCode,
        'Error compiling media feed',
        { message: error.message },
        statusCode
      );
      return addCorsToResponse(errorResponse, request);
    }
  } catch (error) {
    console.error('Unhandled exception in handleRequest:', error);
    const errorResponse = createErrorResponse(
      ERROR_CODES.SERVER_ERROR,
      'An unexpected error occurred',
      { message: error.message },
      500
    );
    return addCorsToResponse(errorResponse, request);
  }
}

// Helper functions for KV access and data processing

async function fetchFromKV(kvNamespaceBinding, key, type = "json") {
  console.log(`Fetching from KV. Key: ${key}, Type: ${type}. Namespace binding type: ${typeof kvNamespaceBinding}`);
  if (typeof kvNamespaceBinding === 'undefined') {
    throw new Error(`KV namespace binding for key '${key}' is undefined. Check binding name and configuration.`);
  }
  try {
    const value = await kvNamespaceBinding.get(key, type);
    if (value === null && type === "json") { // null means key not found or value is explicitly null for JSON
      console.warn(`Key '${key}' not found in KV namespace or its value is null.`);
      throw new Error(`Configuration for key '${key}' not found.`);
    }
    return value;
  } catch (e) {
    console.error(`Failed to fetch or parse from KV for key '${key}': ${e.message}`);
    throw new Error(`Error accessing KV for key '${key}': ${e.message}`);
  }
}

async function getTenantConfigPath(deviceId, tenantMapping, env) {
    if (!tenantMapping || !tenantMapping.mappings || !Array.isArray(tenantMapping.mappings)) {
        console.warn("Tenant mapping data is invalid or missing.");
        return tenantMapping.default?.configPath || null;
    }

    for (const mapping of tenantMapping.mappings) {
        if (mapping.tenantId && mapping.configPath) {
            const deviceListKey = `${mapping.tenantId}:tenant:deviceList`;
            try {
                const deviceList = await fetchFromKV(env.TOPOLO_STATE, deviceListKey, "json");
                
                if (Array.isArray(deviceList) && deviceList.includes(deviceId)) {
                    console.log(`Device ${deviceId} found in list for tenant ${mapping.tenantId}. Using config: ${mapping.configPath}`);
                    return mapping.configPath;
                }
            } catch (error) {
                console.warn(`Could not load or find device list for tenant ${mapping.tenantId} (key: ${deviceListKey}): ${error.message}`);
            }
        }
    }
    console.log(`Device ${deviceId} not found in any specific tenant device list. Using default config: ${tenantMapping.default?.configPath}`);
    return tenantMapping.default?.configPath || null;
}

// Define valid media types and their extensions
const VALID_MEDIA_TYPES = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'],
  video: ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
  document: ['.pdf']
};

// Media validation helper functions
function getFileExtension(url) {
  try {
    // Extract filename from URL by splitting on '/' and getting the last part
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop() || '';
    
    // Handle query parameters
    const filenameWithoutQuery = filename.split('?')[0];
    
    // Get extension (including the dot)
    const extension = filenameWithoutQuery.match(/\.[^.]*$/);
    return extension ? extension[0].toLowerCase() : '';
  } catch (e) {
    console.warn(`Error extracting extension from URL: ${url}, ${e.message}`);
    return '';
  }
}

function guessMediaTypeFromUrl(url) {
  const extension = getFileExtension(url);
  
  // If no extension found, return null
  if (!extension) return null;
  
  // Find media type that contains this extension
  for (const [type, extensions] of Object.entries(VALID_MEDIA_TYPES)) {
    if (extensions.includes(extension)) {
      return type;
    }
  }
  
  // Unknown extension
  return null;
}

// Enhanced transform function with validation and self-healing
function transformMediaItem(item, globalDefaultDuration = 15) {
    // Basic validation
    if (!item || typeof item.url !== 'string') {
        console.warn("Skipping invalid media item (missing required fields):", item);
        return null;
    }
    
    // Clone item to avoid modifying the original
    const processedItem = { ...item };
    
    // 1. Validate and correct media type
    let declaredType = (processedItem.type || '').toLowerCase();
    const inferredType = guessMediaTypeFromUrl(processedItem.url);
    
    // Self-healing for media type
    if (!declaredType || !Object.keys(VALID_MEDIA_TYPES).includes(declaredType)) {
        if (inferredType) {
            console.warn(`Invalid media type "${declaredType}" for item ${processedItem.id || 'unknown'}. Auto-correcting to "${inferredType}" based on URL extension.`);
            declaredType = inferredType;
        } else {
            console.warn(`Invalid media type "${declaredType}" for item ${processedItem.id || 'unknown'} and unable to infer from URL. Skipping.`);
            return null;
        }
    } else if (inferredType && declaredType !== inferredType) {
        // Type mismatch between declared and inferred
        console.warn(`Media type mismatch for item ${processedItem.id || 'unknown'}: declared as "${declaredType}" but URL suggests "${inferredType}". Auto-correcting.`);
        declaredType = inferredType;
    }
    
    // 2. Validate and handle duration based on media type
    let duration;
    if (typeof processedItem.duration === 'number' && processedItem.duration > 0) {
        // Use provided duration if valid
        duration = processedItem.duration;
    } else if (declaredType === 'image') {
        // Only apply default duration to images
        duration = globalDefaultDuration;
    }
    // For videos without duration, leave duration undefined
    
    // 3. Generate ID if not present
    const id = processedItem.id || `media-${hashString(processedItem.url)}`;
    
    // 4. Validate URL (basic check)
    try {
        new URL(processedItem.url);
    } catch (e) {
        console.warn(`Invalid URL "${processedItem.url}" for item ${id}. Skipping.`);
        return null;
    }
    
    // 5. Create sanitized media item - preserve additional properties
    const sanitizedItem = {
        id: id,
        type: declaredType,
        url: processedItem.url,
        ...(duration !== undefined && { duration }),
        // Optional: include a validation flag for debugging
        _validated: true
    };
    
    // Preserve additional properties from the original item (like 'qr', 'tags', etc.)
    // while excluding the core properties we've already processed
    const coreProperties = new Set(['id', 'type', 'url', 'duration', '_validated']);
    Object.keys(processedItem).forEach(key => {
        if (!coreProperties.has(key)) {
            sanitizedItem[key] = processedItem[key];
        }
    });
    
    return sanitizedItem;
}

// Enhanced media compilation - without duplicate filtering
async function compileMediaFeed(deviceId, env) {
  console.log('In compileMediaFeed. KV bindings:', typeof env.TOPOLO_FEED_CONFIG);
  console.log(`Compiling media feed for deviceId: ${deviceId}`);

  const tenantMapping = await fetchFromKV(env.TOPOLO_FEED_CONFIG, TENANT_MAPPING_KEY, "json");
  const baseFeedConfigData = await fetchFromKV(env.TOPOLO_FEED_CONFIG, BASE_FEED_CONFIG_KEY, "json");

  const baseConfig = baseFeedConfigData.baseConfig || { defaultDuration: 15 };

  let tenantConfigKey = await getTenantConfigPath(deviceId, tenantMapping, env);
  let tenantConfigData = {};

  if (tenantConfigKey) {
    try {
      tenantConfigData = await fetchFromKV(env.TOPOLO_FEED_CONFIG, tenantConfigKey, "json");
    } catch (e) {
      console.warn(`Failed to fetch tenant config from TOPOLO_FEED_CONFIG for key ${tenantConfigKey}. Error: ${e.message}`);
    }
  } else {
      console.log(`No specific tenant config key found for device ${deviceId}. Checking for default in tenant mapping.`);
      if (tenantMapping.default && tenantMapping.default.configPath) {
          const defaultTenantKey = tenantMapping.default.configPath;
          console.log(`Using default tenant config key from mapping: ${defaultTenantKey}`);
          try {
              tenantConfigData = await fetchFromKV(env.TOPOLO_FEED_CONFIG, defaultTenantKey, "json");
          } catch (e) {
              console.warn(`Failed to fetch default tenant config from TOPOLO_FEED_CONFIG for key ${defaultTenantKey}. Error: ${e.message}`);
          }
      } else {
          console.warn(`No tenant config key found for device ${deviceId} and no default mapping config key defined.`);
      }
  }

  const tenantSpecificConfig = tenantConfigData.config || {};
  const currentDefaultDuration = tenantSpecificConfig.defaultDuration || baseConfig.defaultDuration || 15;
  const compiledMedia = [];
  
  // Track duplicate items for informational purposes (but still include them)
  const seenIds = new Set();
  let duplicateCount = 0;

  if (tenantConfigData.media && Array.isArray(tenantConfigData.media)) {
    tenantConfigData.media.forEach(item => {
      const transformed = transformMediaItem(item, currentDefaultDuration);
      if (transformed) {
        compiledMedia.push(transformed);
        // Just log duplicates for information
        if (seenIds.has(transformed.id)) {
          duplicateCount++;
        } else {
          seenIds.add(transformed.id);
        }
      }
    });
  }

  const mediaOptions = tenantConfigData.mediaOptions || {};
  const includeBaseMedia = mediaOptions.includeBaseMedia === undefined ? true : mediaOptions.includeBaseMedia;
  if (includeBaseMedia && baseFeedConfigData.baseMedia && Array.isArray(baseFeedConfigData.baseMedia)) {
    baseFeedConfigData.baseMedia.forEach(item => {
      const transformed = transformMediaItem(item, baseConfig.defaultDuration);
      if (transformed) {
        compiledMedia.push(transformed);
        // Just log duplicates for information
        if (seenIds.has(transformed.id)) {
          duplicateCount++;
        } else {
          seenIds.add(transformed.id);
        }
      }
    });
  }

  if (baseFeedConfigData.contentCategories && tenantConfigData.contentCategorySettings) {
    for (const categoryId in baseFeedConfigData.contentCategories) {
      const categoryGlobalDef = baseFeedConfigData.contentCategories[categoryId];
      const tenantCategorySetting = tenantConfigData.contentCategorySettings[categoryId];
      if (tenantCategorySetting && tenantCategorySetting.enabled && categoryGlobalDef.contentPath) {
        try {
          const categoryContent = await fetchFromKV(env.TOPOLO_FEED_CONFIG, categoryGlobalDef.contentPath, "json");
          if (categoryContent.media && Array.isArray(categoryContent.media)) {
            categoryContent.media.forEach(item => {
              if (shouldIncludeCategoryItem(item, tenantCategorySetting, categoryContent.adGroups)) {
                const transformed = transformMediaItem(item, currentDefaultDuration);
                if (transformed) {
                  compiledMedia.push(transformed);
                  // Just log duplicates for information
                  if (seenIds.has(transformed.id)) {
                    duplicateCount++;
                  } else {
                    seenIds.add(transformed.id);
                  }
                }
              }
            });
          }
        } catch (e) {
          console.error(`Skipping category ${categoryId} (key: ${categoryGlobalDef.contentPath}) due to error: ${e.message}`);
        }
      }
    }
  }
  
  // Sanity check: ensure we have at least one media item
  if (compiledMedia.length === 0) {
    console.warn(`No valid media items found for device ${deviceId}. Adding a default fallback item.`);
    const fallbackImageUrl = baseConfig.fallbackImage || "https://via.placeholder.com/1920x1080?text=No+Content+Available";
    compiledMedia.push({
      id: "fallback-001",
      type: "image",
      url: fallbackImageUrl,
      duration: currentDefaultDuration
    });
  }
  
  const uniqueItemCount = seenIds.size;
  console.log(`Compiled ${compiledMedia.length} media items for device ${deviceId} (${uniqueItemCount} unique items, ${duplicateCount} duplicates).`);
  return compiledMedia;
}

function shouldIncludeCategoryItem(item, tenantCategorySetting, categoryAdGroups) {
    if (!item || !item.id) return false;
    if (tenantCategorySetting.includedGroups && Array.isArray(tenantCategorySetting.includedGroups) && tenantCategorySetting.includedGroups.length > 0) {
        let isInIncludedGroup = false;
        for (const groupName of tenantCategorySetting.includedGroups) {
            if (categoryAdGroups && categoryAdGroups[groupName] && Array.isArray(categoryAdGroups[groupName]) && categoryAdGroups[groupName].includes(item.id)) {
                isInIncludedGroup = true;
                break;
            }
        }
        if (!isInIncludedGroup) return false;
    }
    if (tenantCategorySetting.excludedTags && Array.isArray(tenantCategorySetting.excludedTags) && item.tags && Array.isArray(item.tags)) {
        for (const excludedTag of tenantCategorySetting.excludedTags) {
            if (item.tags.map(t => String(t).toLowerCase()).includes(String(excludedTag).toLowerCase())) {
                return false;
            }
        }
    }
    return true;
}

// Simple string hashing function to generate ids from URLs where needed
function hashString(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16); // Use hex format for shorter ids
} 