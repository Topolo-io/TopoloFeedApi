// DOM Elements
const deviceForm = document.getElementById('deviceForm');
const deviceIdInput = document.getElementById('deviceId');
const apiEndpointInput = document.getElementById('apiEndpoint');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const feedContainer = document.getElementById('feedContainer');
const jsonOutput = document.getElementById('jsonOutput');
const tenantInfo = document.getElementById('tenantInfo');
const cancelLoadingBtn = document.getElementById('cancelLoadingBtn');
const feedStatsEl = {
    totalItems: document.getElementById('totalItems'),
    imageCount: document.getElementById('imageCount'),
    videoCount: document.getElementById('videoCount'),
    totalDuration: document.getElementById('totalDuration')
};

// KV fetch elements
const refreshCompiledFeed = document.getElementById('refreshCompiledFeed');
const fetchTenantMapping = document.getElementById('fetchTenantMapping');
const fetchBaseFeed = document.getElementById('fetchBaseFeed');
const fetchTenantConfig = document.getElementById('fetchTenantConfig');
const fetchCategories = document.getElementById('fetchCategories');
const tenantMappingOutput = document.getElementById('tenantMappingOutput');
const baseFeedOutput = document.getElementById('baseFeedOutput');
const tenantConfigOutput = document.getElementById('tenantConfigOutput');
const categoriesOutput = document.getElementById('categoriesOutput');
const tenantConfigSelector = document.getElementById('tenantConfigSelector');
const categoriesSelector = document.getElementById('categoriesSelector');

// Bootstrap components
const loadingModal = new bootstrap.Modal(document.getElementById('loadingModal'), {
    keyboard: false,
    backdrop: 'static'
});

// Global variables
let currentDeviceId = '';
let currentEndpoint = '';
let isLoading = false;
let abortController = null;

// Store loaded data
const kvData = {
    feed: null,
    tenantMapping: null,
    baseFeed: null,
    tenantConfigs: {},
    categories: {}
};

// Event Listeners - Main feed fetch
deviceForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const deviceId = deviceIdInput.value.trim();
    const apiEndpoint = apiEndpointInput.value.trim();
    
    if (!deviceId) {
        alert('Please enter a device ID');
        return;
    }
    
    currentDeviceId = deviceId;
    currentEndpoint = apiEndpoint;
    
    await fetchFeed(deviceId, apiEndpoint);
});

testConnectionBtn.addEventListener('click', async function() {
    const apiEndpoint = apiEndpointInput.value.trim();
    
    if (!apiEndpoint) {
        alert('Please enter an API endpoint URL');
        return;
    }
    
    await testConnection(apiEndpoint);
});

// Event Listeners - KV data tabs
refreshCompiledFeed.addEventListener('click', function() {
    if (currentDeviceId && currentEndpoint) {
        fetchFeed(currentDeviceId, currentEndpoint);
    } else {
        alert('Please fetch a feed first (enter a device ID and click "Get Feed")');
    }
});

fetchTenantMapping.addEventListener('click', async function() {
    await fetchKV('tenant-mapping', tenantMappingOutput);
});

fetchBaseFeed.addEventListener('click', async function() {
    await fetchKV('feed', baseFeedOutput);
});

fetchTenantConfig.addEventListener('click', async function() {
    const tenant = tenantConfigSelector.value;
    if (!tenant) {
        alert('Please select a tenant');
        return;
    }
    await fetchKV(tenant, tenantConfigOutput);
});

fetchCategories.addEventListener('click', async function() {
    const category = categoriesSelector.value;
    if (!category) {
        alert('Please select a category');
        return;
    }
    await fetchKV(category, categoriesOutput);
});

// Cancel button for loading modal
cancelLoadingBtn.addEventListener('click', function() {
    if (abortController) {
        abortController.abort();
    }
    hideLoading();
});

// Helper function to show loading
function showLoading(message) {
    isLoading = true;
    document.getElementById('loadingMessage').textContent = message || 'Loading...';
    loadingModal.show();
}

// Helper function to hide loading
function hideLoading() {
    isLoading = false;
    if (loadingModal._isShown) {
        loadingModal.hide();
    }
}

// Helper function for fetch with abort controller
async function fetchWithRetry(url, options = {}, maxRetries = 3, retryDelay = 1000) {
    // Create a new AbortController for this request
    abortController = new AbortController();
    
    // Add the signal to the options
    const fetchOptions = {
        ...options,
        signal: abortController.signal
    };
    
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fetch(url, fetchOptions);
        } catch (error) {
            // If this was aborted, don't retry
            if (error.name === 'AbortError') {
                throw new Error('Request was cancelled');
            }
            
            console.log(`Fetch attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
            lastError = error;
            
            if (attempt < maxRetries - 1) {
                // Show a message that we're retrying
                document.getElementById('loadingMessage').textContent = 
                    `Connection attempt ${attempt + 1} failed, retrying in ${retryDelay/1000}s...`;
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }
    
    // If we get here, all retries failed
    throw new Error(`Failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
}

// Main feed fetch function
async function fetchFeed(deviceId, apiEndpoint) {
    try {
        // Show loading
        showLoading(`Fetching media feed for device: ${deviceId}`);
        
        // Fetch from API with CORS mode specified and retry
        let response;
        try {
            response = await fetchWithRetry(`${apiEndpoint}/${deviceId}`, {
                method: 'GET',
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
        } catch (connectionError) {
            // Make sure to hide loading in case of error
            hideLoading();
            // Handle network-level errors like connection closed
            throw new Error(`Connection error: ${connectionError.message || 'Connection closed unexpectedly'}. Please check if the API endpoint is correct and the server is running.`);
        }
        
        let data;
        try {
            data = await response.json();
        } catch (jsonError) {
            hideLoading();
            throw new Error(`Failed to parse API response as JSON: ${jsonError.message}. The server may have returned an invalid response or the connection was closed prematurely.`);
        }
        
        // Hide loading
        hideLoading();
        
        // Store data
        kvData.feed = data;
        
        if (response.ok) {
            // Display the feed
            displayFeed(data);
            
            // Update tenant mapping selector if we have tenant info
            if (data.tenant && data.tenant.id) {
                const tenantOption = document.createElement('option');
                tenantOption.value = `${data.tenant.id}_tenant`;
                tenantOption.textContent = data.tenant.id;
                
                // Check if this tenant is already in the selector
                let exists = false;
                for (let i = 0; i < tenantConfigSelector.options.length; i++) {
                    if (tenantConfigSelector.options[i].value === tenantOption.value) {
                        exists = true;
                        break;
                    }
                }
                
                if (!exists) {
                    tenantConfigSelector.appendChild(tenantOption);
                }
                
                // Select this tenant
                tenantConfigSelector.value = tenantOption.value;
            }
            
            // Update tenant info display
            if (data.tenant) {
                tenantInfo.innerHTML = `
                    <strong>Tenant ID:</strong> ${data.tenant.id || 'Unknown'}<br>
                    <strong>Name:</strong> ${data.tenant.name || data.tenant.id || 'Unknown'}<br>
                    <strong>Config Path:</strong> ${data.tenant.configPath || 'N/A'}
                `;
                tenantInfo.className = 'alert alert-info';
            } else {
                tenantInfo.textContent = "No tenant information available";
                tenantInfo.className = 'alert alert-warning';
            }
        } else {
            // Display error
            feedContainer.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger">
                        <h5>Error</h5>
                        <p>${data.error || 'Unknown error'}</p>
                    </div>
                </div>
            `;
            jsonOutput.textContent = JSON.stringify(data, null, 2);
            
            tenantInfo.textContent = "Failed to fetch feed";
            tenantInfo.className = 'alert alert-danger';
            
            // Reset stats
            updateStats(null);
        }
    } catch (error) {
        // Make absolutely sure the loading is hidden
        hideLoading();
        
        feedContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <h5>Error</h5>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
        
        jsonOutput.textContent = `Error: ${error.message}`;
        tenantInfo.textContent = "Failed to fetch feed";
        tenantInfo.className = 'alert alert-danger';
        updateStats(null);
    }
}

// Function to fetch KV data from admin endpoint
async function fetchKV(key, outputElement) {
    try {
        const apiEndpoint = apiEndpointInput.value.trim();
        if (!apiEndpoint) {
            alert('Please enter an API endpoint URL');
            return;
        }
        
        // Show loading
        showLoading(`Fetching KV data: ${key}`);
        
        const response = await fetchWithRetry(`${apiEndpoint}/admin/kv/NODO_FEED_CONFIG/${key}`, {
            method: 'GET',
            mode: 'cors',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const data = await response.json();
        
        // Hide loading
        hideLoading();
        
        // Store data
        if (key === 'tenant-mapping') {
            kvData.tenantMapping = data;
            
            // Update tenant selector with tenant mapping data
            if (data && data.mappings) {
                // Clear existing options except the placeholder
                while (tenantConfigSelector.options.length > 1) {
                    tenantConfigSelector.remove(1);
                }
                
                // Add tenants from the mapping
                data.mappings.forEach(tenant => {
                    const option = document.createElement('option');
                    option.value = tenant.configPath;
                    option.textContent = tenant.displayName || tenant.tenantId;
                    tenantConfigSelector.appendChild(option);
                });
                
                // Add default tenant if present
                if (data.default) {
                    const option = document.createElement('option');
                    option.value = data.default.configPath;
                    option.textContent = 'Default';
                    tenantConfigSelector.appendChild(option);
                }
            }
        } else if (key === 'feed') {
            kvData.baseFeed = data;
            
            // Update categories selector with categories from base feed
            if (data && data.contentCategories) {
                // Clear existing options except the placeholder
                while (categoriesSelector.options.length > 1) {
                    categoriesSelector.remove(1);
                }
                
                // Add categories from the base feed
                Object.keys(data.contentCategories).forEach(category => {
                    const option = document.createElement('option');
                    option.value = data.contentCategories[category].contentPath;
                    option.textContent = category;
                    categoriesSelector.appendChild(option);
                });
            }
        } else if (categoriesSelector.value === key) {
            kvData.categories[key] = data;
        } else {
            kvData.tenantConfigs[key] = data;
        }
        
        // Display the data
        outputElement.textContent = JSON.stringify(data, null, 2);
        
    } catch (error) {
        // Make sure loading is hidden
        hideLoading();
        outputElement.textContent = `Error: ${error.message}\n\nMake sure your API has the admin endpoints enabled.\nThe URL format should be:\n${apiEndpointInput.value.trim()}/admin/kv/NODO_FEED_CONFIG/${key}`;
    }
}

// Display feed function
function displayFeed(feedData) {
    if (!Array.isArray(feedData) || feedData.length === 0) {
        feedContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-warning">
                    <h5>Empty Feed</h5>
                    <p>The feed contains no media items.</p>
                </div>
            </div>
        `;
        jsonOutput.textContent = JSON.stringify(feedData, null, 2);
        updateStats(feedData);
        return;
    }
    
    // Format the JSON display
    jsonOutput.textContent = JSON.stringify(feedData, null, 2);
    
    // Update stats
    updateStats(feedData);
    
    // Build the visual feed
    let feedHtml = '';
    
    feedData.forEach((item, index) => {
        const mediaId = item.id || `media-${index}`;
        const duration = item.duration || 'N/A';
        
        let mediaPreview = '';
        if (item.type === 'image') {
            mediaPreview = `
                <div class="position-relative">
                    <img src="${item.url}" alt="Media item ${mediaId}" class="media-preview">
                    <span class="duration-badge">${duration}s</span>
                </div>
            `;
        } else if (item.type === 'video') {
            mediaPreview = `
                <div class="position-relative">
                    <video src="${item.url}" controls class="media-preview"></video>
                    <span class="duration-badge">${duration}s</span>
                </div>
            `;
        } else {
            mediaPreview = `
                <div class="preview-placeholder">
                    <span>${item.type}</span>
                </div>
            `;
        }
        
        feedHtml += `
            <div class="col-md-6 col-lg-4">
                <div class="media-item">
                    <h6 class="media-title">${item.id || 'No ID'}</h6>
                    <div class="text-muted">${item.type}</div>
                    ${mediaPreview}
                    <div class="mt-2">
                        <small class="text-truncate d-block">${item.url}</small>
                    </div>
                </div>
            </div>
        `;
    });
    
    feedContainer.innerHTML = feedHtml;
}

// Update stats function
function updateStats(feedData) {
    if (!feedData || !Array.isArray(feedData)) {
        feedStatsEl.totalItems.textContent = '-';
        feedStatsEl.imageCount.textContent = '-';
        feedStatsEl.videoCount.textContent = '-';
        feedStatsEl.totalDuration.textContent = '-';
        return;
    }
    
    const stats = {
        total: feedData.length,
        images: feedData.filter(item => item.type === 'image').length,
        videos: feedData.filter(item => item.type === 'video').length,
        duration: feedData.reduce((sum, item) => sum + (parseInt(item.duration) || 0), 0)
    };
    
    feedStatsEl.totalItems.textContent = stats.total;
    feedStatsEl.imageCount.textContent = stats.images;
    feedStatsEl.videoCount.textContent = stats.videos;
    feedStatsEl.totalDuration.textContent = `${stats.duration}s`;
}

// Test connection function
async function testConnection(apiEndpoint) {
    try {
        // Show loading
        showLoading(`Testing connection to: ${apiEndpoint}`);
        
        // First try health endpoint, then fall back to OPTIONS request
        let connected = false;
        
        try {
            // Try health endpoint first
            const healthResponse = await fetchWithRetry(`${apiEndpoint}/health`, {
                method: 'HEAD',
                mode: 'cors',
            }, 1);
            
            if (healthResponse.ok) {
                connected = true;
                hideLoading();
                feedContainer.innerHTML = `
                    <div class="col-12">
                        <div class="alert alert-success">
                            <h5>Connection Successful</h5>
                            <p>Successfully connected to the API health endpoint.</p>
                        </div>
                    </div>
                `;
                return;
            }
        } catch (healthError) {
            console.log("Health endpoint not available, trying OPTIONS request...");
        }
        
        if (!connected) {
            try {
                // Fall back to OPTIONS request to root endpoint
                const optionsResponse = await fetchWithRetry(apiEndpoint, {
                    method: 'OPTIONS',
                    mode: 'cors',
                }, 1);
                
                hideLoading();
                feedContainer.innerHTML = `
                    <div class="col-12">
                        <div class="alert alert-success">
                            <h5>Connection Successful</h5>
                            <p>Successfully connected to the API endpoint.</p>
                            <p>Note: No health endpoint found, but the API server is responding.</p>
                        </div>
                    </div>
                `;
                return;
            } catch (optionsError) {
                throw new Error(`Connection failed: ${optionsError.message}. Please check if the API endpoint is correct and the server is running.`);
            }
        }
        
    } catch (error) {
        // Make sure loading is hidden
        hideLoading();
        
        feedContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <h5>Connection Error</h5>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
    }
}

// Utility function to change endpoint
function useAlternativeEndpoint(endpoint) {
    apiEndpointInput.value = endpoint;
    testConnectionBtn.click();
}

// Initialize with sample device ID if present in URL
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const deviceIdParam = urlParams.get('deviceId');
    if (deviceIdParam) {
        deviceIdInput.value = deviceIdParam;
        // Auto-submit
        deviceForm.dispatchEvent(new Event('submit'));
    }
    
    // Window beforeunload handler to abort any pending requests
    window.addEventListener('beforeunload', function() {
        if (abortController) {
            abortController.abort();
        }
    });
}); 