import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { cache } from 'hono/cache';
import { z } from 'zod';

// Types
interface Env {
  NODO_FEED_CONFIG: KVNamespace;
  NODO_STATE: KVNamespace;
}

interface MediaItem {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  duration?: number;
  qr?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface TenantMapping {
  mappings: Array<{
    tenantId: string;
    configPath: string;
  }>;
  default?: {
    configPath: string;
  };
}

interface FeedConfig {
  baseConfig: {
    defaultDuration: number;
    fallbackImage?: string;
  };
  baseMedia?: MediaItem[];
  contentCategories?: Record<string, {
    contentPath: string;
  }>;
}

interface TenantConfig {
  config?: {
    defaultDuration?: number;
  };
  media?: MediaItem[];
  mediaOptions?: {
    includeBaseMedia?: boolean;
  };
  contentCategorySettings?: Record<string, {
    enabled: boolean;
    includedGroups?: string[];
    excludedTags?: string[];
  }>;
}

interface DeviceFeedAssignment {
  deviceId: string;
  tenantId?: string;
  mode?: string;
  kind?: 'current_feed' | 'tenant_feed' | 'manual_playlist';
  label?: string | null;
  sourceDeviceId?: string | null;
  playlistName?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

// App
const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Device-ID', 'X-API-Key'],
  maxAge: 86400,
}));

app.use('*', logger());

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Root endpoint
app.get('/', (c) => {
  return c.json({
    api: 'Nodo Feed API',
    version: '2.0.0',
    usage: 'GET /{deviceId} - Get media feed for device',
    endpoints: {
      '/{deviceId}': 'Get media feed for specific device',
      '/health': 'Health check endpoint'
    }
  });
});

// Main feed endpoint
app.get('/:deviceId', async (c) => {
  const deviceId = c.req.param('deviceId');
  
  if (deviceId === 'favicon.ico') {
    return c.notFound();
  }
  
  try {
    const feed = await compileFeed(c.env, deviceId);
    
    return c.json(feed, 200, {
      'Cache-Control': 'private, max-age=300'
    });
  } catch (error) {
    console.error(`Error compiling feed for ${deviceId}:`, error);
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('not found') ? 404 : 500;
    
    return c.json({
      error: {
        code: status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR',
        message: 'Error compiling media feed',
        details: message
      }
    }, status);
  }
});

// Feed compilation
async function compileFeed(env: Env, deviceId: string): Promise<MediaItem[]> {
  // Load tenant mapping
  const tenantMapping = await getKV<TenantMapping>(env.NODO_FEED_CONFIG, 'tenant-mapping');
  const baseFeedConfig = await getKV<FeedConfig>(env.NODO_FEED_CONFIG, 'feed');
  
  const baseConfig = baseFeedConfig.baseConfig || { defaultDuration: 15 };
  const defaultDuration = baseConfig.defaultDuration;
  
  // Find tenant config for this device
  const tenantConfigKey = await resolveFeedConfigPath(env, deviceId, tenantMapping);
  let tenantConfig: TenantConfig = {};
  
  if (tenantConfigKey) {
    try {
      tenantConfig = await getKV<TenantConfig>(env.NODO_FEED_CONFIG, tenantConfigKey);
    } catch (e) {
      console.warn(`Could not load tenant config: ${tenantConfigKey}`);
    }
  }
  
  const effectiveDuration = tenantConfig.config?.defaultDuration || defaultDuration;
  const media: MediaItem[] = [];
  
  // Add tenant-specific media
  if (tenantConfig.media?.length) {
    for (const item of tenantConfig.media) {
      const transformed = transformMedia(item, effectiveDuration);
      if (transformed) media.push(transformed);
    }
  }
  
  // Add base media if enabled
  const includeBase = tenantConfig.mediaOptions?.includeBaseMedia !== false;
  if (includeBase && baseFeedConfig.baseMedia?.length) {
    for (const item of baseFeedConfig.baseMedia) {
      const transformed = transformMedia(item, defaultDuration);
      if (transformed) media.push(transformed);
    }
  }
  
  // Add category content
  if (baseFeedConfig.contentCategories && tenantConfig.contentCategorySettings) {
    for (const [categoryId, categoryDef] of Object.entries(baseFeedConfig.contentCategories)) {
      const settings = tenantConfig.contentCategorySettings[categoryId];
      
      if (settings?.enabled && categoryDef.contentPath) {
        try {
          const categoryContent = await getKV<{ media?: MediaItem[]; adGroups?: Record<string, string[]> }>(
            env.NODO_FEED_CONFIG, 
            categoryDef.contentPath
          );
          
          if (categoryContent.media?.length) {
            for (const item of categoryContent.media) {
              if (shouldInclude(item, settings, categoryContent.adGroups)) {
                const transformed = transformMedia(item, effectiveDuration);
                if (transformed) media.push(transformed);
              }
            }
          }
        } catch (e) {
          console.warn(`Skipping category ${categoryId}: ${e}`);
        }
      }
    }
  }
  
  // Fallback if empty
  if (media.length === 0) {
    const fallbackUrl = baseConfig.fallbackImage || 
      'https://via.placeholder.com/1920x1080?text=No+Content+Available';
    
    media.push({
      id: 'fallback-001',
      type: 'image',
      url: fallbackUrl,
      duration: defaultDuration
    });
  }
  
  return media;
}

// Find tenant config path for device
async function findTenantConfig(
  env: Env, 
  deviceId: string, 
  mapping: TenantMapping,
  tenantIdHint?: string | null,
): Promise<string | null> {
  if (tenantIdHint) {
    const directConfig = mapping.mappings?.find((entry) => entry.tenantId === tenantIdHint)?.configPath;
    if (directConfig) {
      return directConfig;
    }
  }

  if (!mapping.mappings?.length) {
    return mapping.default?.configPath || null;
  }
  
  for (const { tenantId, configPath } of mapping.mappings) {
    const deviceListKey = `${tenantId}:tenant:deviceList`;
    
    try {
      const deviceList = await getKV<string[]>(env.NODO_STATE, deviceListKey);
      if (deviceList.includes(deviceId)) {
        return configPath;
      }
    } catch {
      // Device list not found for this tenant
    }
  }
  
  return mapping.default?.configPath || null;
}

async function resolveFeedConfigPath(
  env: Env,
  deviceId: string,
  mapping: TenantMapping,
  visitedDeviceIds = new Set<string>(),
): Promise<string | null> {
  if (visitedDeviceIds.has(deviceId)) {
    throw new Error(`Feed assignment loop detected for device ${deviceId}`);
  }

  visitedDeviceIds.add(deviceId);

  const assignment = await readDeviceFeedAssignment(env, deviceId);

  if (assignment?.kind === 'manual_playlist') {
    return resolveManualPlaylistConfigPath(env, assignment.playlistName);
  }

  if (assignment?.kind === 'current_feed' && assignment.sourceDeviceId && assignment.sourceDeviceId !== deviceId) {
    return resolveFeedConfigPath(env, assignment.sourceDeviceId, mapping, visitedDeviceIds);
  }

  return findTenantConfig(env, deviceId, mapping, assignment?.tenantId || null);
}

async function resolveManualPlaylistConfigPath(env: Env, playlistName?: string | null): Promise<string> {
  const normalizedName = typeof playlistName === 'string' ? playlistName.trim() : '';
  if (!normalizedName) {
    throw new Error('Manual playlist key is missing');
  }

  const candidateKeys = Array.from(new Set([normalizedName, `playlist:${normalizedName}`]));

  for (const key of candidateKeys) {
    const configValue = await env.NODO_FEED_CONFIG.get(key);
    if (configValue) {
      return key;
    }
  }

  throw new Error(`Manual playlist '${normalizedName}' was not found`);
}

async function readDeviceFeedAssignment(env: Env, deviceId: string): Promise<DeviceFeedAssignment | null> {
  const rawValue = await env.NODO_STATE.get(`deviceFeedAssignment:${deviceId}`);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as DeviceFeedAssignment;
  } catch (error) {
    console.warn(`Skipping invalid device feed assignment for ${deviceId}:`, error);
    return null;
  }
}

// Transform and validate media item
function transformMedia(item: Partial<MediaItem>, defaultDuration: number): MediaItem | null {
  if (!item.url || typeof item.url !== 'string') return null;
  
  // Infer type from URL if not provided
  let type = item.type;
  if (!type) {
    const ext = item.url.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      type = 'image';
    } else if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
      type = 'video';
    } else {
      type = 'image'; // Default
    }
  }
  
  // Validate URL
  try {
    new URL(item.url);
  } catch {
    return null;
  }
  
  // Generate ID if missing
  const id = item.id || `media-${hashString(item.url)}`;
  
  // Duration only for images
  const duration = type === 'image' 
    ? (item.duration && item.duration > 0 ? item.duration : defaultDuration)
    : undefined;
  
  return {
    id,
    type,
    url: item.url,
    ...(duration !== undefined && { duration }),
    ...(item.qr && { qr: item.qr }),
    ...(item.tags && { tags: item.tags }),
    ...(item.metadata && { metadata: item.metadata })
  };
}

// Check if item should be included based on settings
function shouldInclude(
  item: MediaItem, 
  settings: { includedGroups?: string[]; excludedTags?: string[] },
  adGroups?: Record<string, string[]>
): boolean {
  if (!item.id) return false;
  
  // Check included groups
  if (settings.includedGroups?.length && adGroups) {
    const inGroup = settings.includedGroups.some(groupName => 
      adGroups[groupName]?.includes(item.id)
    );
    if (!inGroup) return false;
  }
  
  // Check excluded tags
  if (settings.excludedTags?.length && item.tags?.length) {
    const hasExcluded = settings.excludedTags.some(tag =>
      item.tags!.map(t => t.toLowerCase()).includes(tag.toLowerCase())
    );
    if (hasExcluded) return false;
  }
  
  return true;
}

// KV helper with error handling
async function getKV<T>(kv: KVNamespace, key: string): Promise<T> {
  const value = await kv.get(key, 'json');
  if (value === null) {
    throw new Error(`Key '${key}' not found`);
  }
  return value as T;
}

// Simple string hash for generating IDs
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export default app;
